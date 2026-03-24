import type { Express } from "express";
import { createServer, type Server } from "http";
import express from "express";
import { storage } from "./storage";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import multer from "multer";
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { VIDEO_MODELS, type GenerationType, getModelsForGenerationType, GENERATION_TYPE_CONFIGS } from "@shared/videoModels";
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import heicConvert from 'heic-convert';

// Helper function to compress images for Claude API (5MB limit)
async function compressImageForClaude(base64DataUrl: string, maxSizeBytes: number = 4 * 1024 * 1024): Promise<string> {
  // Extract the data part from the data URL
  const match = base64DataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) {
    return base64DataUrl; // Return as-is if not a valid data URL
  }
  
  const [, mediaType, base64Data] = match;
  const buffer = Buffer.from(base64Data, 'base64');
  
  // Check if already under the limit
  if (buffer.length <= maxSizeBytes) {
    return base64DataUrl;
  }
  
  console.log(`[Image Compress] Image size ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds limit, compressing...`);
  
  // Calculate target quality based on size ratio
  const sizeRatio = maxSizeBytes / buffer.length;
  let quality = Math.floor(sizeRatio * 100);
  quality = Math.max(20, Math.min(quality, 80)); // Clamp between 20 and 80
  
  try {
    // Resize and compress with sharp
    let sharpInstance = sharp(buffer);
    const metadata = await sharpInstance.metadata();
    
    // Resize if very large (max 2048px on longest side)
    const maxDimension = 2048;
    if (metadata.width && metadata.height) {
      const longestSide = Math.max(metadata.width, metadata.height);
      if (longestSide > maxDimension) {
        const scale = maxDimension / longestSide;
        sharpInstance = sharpInstance.resize(
          Math.round(metadata.width * scale),
          Math.round(metadata.height * scale)
        );
      }
    }
    
    // Convert to JPEG for better compression
    const compressedBuffer = await sharpInstance
      .jpeg({ quality })
      .toBuffer();
    
    console.log(`[Image Compress] Compressed from ${(buffer.length / 1024 / 1024).toFixed(2)}MB to ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB`);
    
    // Return as new data URL
    const newBase64 = compressedBuffer.toString('base64');
    return `data:image/jpeg;base64,${newBase64}`;
  } catch (error) {
    console.error('[Image Compress] Failed to compress image:', error);
    return base64DataUrl; // Return original if compression fails
  }
}

const execAsync = promisify(exec);
import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 configuration for MTP-Images
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = "entremaximages";
const R2_PUBLIC_URL = "https://mtp-images.com";

// Validate R2 configuration
const isR2Configured = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
if (!isR2Configured) {
  console.warn('[MTP-Images] Cloudflare R2 not fully configured. Missing environment variables.');
}

const r2Client = isR2Configured ? new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID!,
    secretAccessKey: R2_SECRET_ACCESS_KEY!,
  },
}) : null;

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

// Sora API key for kie.ai video generation
const videoApiKey = process.env.SORA_VERIFIED_KEY;
if (videoApiKey) {
  console.log(`[Sora/kie.ai] Using SORA_VERIFIED_KEY: ${videoApiKey.substring(0, 8)}...${videoApiKey.substring(videoApiKey.length - 4)}`);
} else {
  console.error('[Sora/kie.ai] WARNING: SORA_VERIFIED_KEY not found!');
}

/*
The newest Anthropic model is "claude-sonnet-4-20250514", not "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022" nor "claude-3-sonnet-20240229". 
If the user doesn't specify a model, always prefer using "claude-sonnet-4-20250514" as it is the latest model.
*/
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize Gemini for image generation
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for videos
});

// Directory for generated videos
const GENERATED_VIDEOS_DIR = path.join(process.cwd(), 'generated_videos');

// Helper function to save video to disk and return URL
async function saveVideoToFile(videoBuffer: Buffer): Promise<string> {
  // Ensure directory exists
  await fs.mkdir(GENERATED_VIDEOS_DIR, { recursive: true });
  
  // Generate unique filename
  const filename = `${crypto.randomBytes(16).toString('hex')}.mp4`;
  const filePath = path.join(GENERATED_VIDEOS_DIR, filename);
  
  // Save file
  await fs.writeFile(filePath, videoBuffer);
  
  // Return URL
  return `/generated-videos/${filename}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve generated videos
  app.use('/generated-videos', express.static(GENERATED_VIDEOS_DIR));
  
  // Serve uploaded files for GIF conversion
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // Suggest display name from manual content
  app.post("/api/suggest-display-name", async (req, res) => {
    try {
      const { manualContent, internalName } = req.body;

      if (!manualContent || manualContent.trim().length < 20) {
        return res.json({ success: true, displayName: "" });
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "user",
            content: `Based on this product sales content, extract the customer-facing product name that should appear in marketing emails.

Internal name: ${internalName}

Sales content:
${manualContent}

Rules:
- Return ONLY the clean, customer-facing product name
- Remove internal tags like "High Ticket", "Low Ticket", "F+S", etc.
- Keep brand names and actual product model names
- If the product is "Tacright GasMask High Ticket", return "Tacright GasMask"
- If the product is "XYZ Knife F+S Deal", return "XYZ Knife"
- Return a SHORT name (2-4 words max) that customers would recognize

Return valid JSON:
{
  "displayName": "extracted name here"
}`
          }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 100
      });

      const rawContent = completion.choices[0].message.content;
      if (!rawContent) {
        return res.json({ success: true, displayName: "" });
      }

      const result = JSON.parse(rawContent);
      res.json({ success: true, displayName: result.displayName || "" });
    } catch (error) {
      console.error("Error suggesting display name:", error);
      res.json({ success: true, displayName: "" }); // Fail silently
    }
  });

  // Audit product offer link and extract key details
  app.post("/api/audit-product", async (req, res) => {
    try {
      const { offerLink, productName, manualContent } = req.body;

      // If manual content is provided and not empty, use it
      const contentToAnalyze = manualContent && manualContent.trim().length > 0
        ? `Product Name: ${productName}

Manual Sales Page Content:
${manualContent}

Extract the retail price and return JSON:
{
  "price": "regular/retail price as string (e.g., '$189' or null)"
}`
        : `Analyze this product page: ${offerLink}

Product Name: ${productName}

Extract the retail price and return JSON:
{
  "price": "regular/retail price as string (e.g., '$189' or null)"
}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "user",
            content: contentToAnalyze
          }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 8000
      });

      console.log("Audit completion finish reason:", completion.choices[0].finish_reason);
      const rawContent = completion.choices[0].message.content;
      console.log("Audit raw content:", rawContent);

      if (!rawContent) {
        console.error("Audit returned no content!");
        return res.json({ success: true, productDetails: { error: "AI returned no content" } });
      }

      const productDetails = JSON.parse(rawContent);
      
      res.json({ success: true, productDetails });
    } catch (error) {
      console.error("Error auditing product:", error);
      res.status(500).json({ success: false, error: "Failed to audit product link" });
    }
  });

  // Helper function to generate emails with Claude
  async function generateEmailsWithClaude(
    productName: string,
    productDetails: any,
    manualContent: string,
    toneAngle: string,
    customTone: string,
    offerType: string,
    offerLink: string,
    winnerExamplesSection: string,
    toneSystemPrompts: Record<string, string>,
    toneUserPrompts: Record<string, string>
  ) {
    console.log("Claude manualContent length:", manualContent?.length || 0);
    console.log("Claude manualContent first 200 chars:", manualContent?.substring(0, 200) || "EMPTY");
    
    const systemPrompt = `${toneSystemPrompts[toneAngle] || toneSystemPrompts['legendary-copywriters']}

Requirements:
- Style CTAs as <a href="[LINK]" style="color:#0066cc">anchor text</a>

Return JSON:
{
  "variations": [
    {
      "subjects": ["subject1", "subject2", "subject3"],
      "body": "email body with HTML formatting"
    }
  ]
}`;

    const userPrompt = `${toneUserPrompts[toneAngle] || toneUserPrompts['legendary-copywriters']}

${manualContent}

${winnerExamplesSection}`;

    console.log("=== CLAUDE USER PROMPT START ===");
    console.log(userPrompt);
    console.log("=== CLAUDE USER PROMPT END ===");

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 20000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    });

    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    console.log("Claude raw response:", rawContent);
    
    if (!rawContent) {
      throw new Error("Claude returned no content");
    }

    // Claude may wrap JSON in markdown code fences - extract the JSON
    let jsonContent = rawContent.trim();
    
    // Remove markdown code fences if present
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.replace(/^```json\s*\n/, '').replace(/\n```\s*$/, '');
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.replace(/^```\s*\n/, '').replace(/\n```\s*$/, '');
    }

    const result = JSON.parse(jsonContent);
    let variations = result.variations || [];
    
    // Clean up each variation
    variations = variations.map((v: any) => ({
      ...v,
      body: v.body
        // Convert markdown bold to HTML
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Convert markdown italic to HTML (single asterisk, not already part of bold)
        .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>')
        // Remove all header tags and their content
        .replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, '')
        // Remove excessive consecutive line breaks (more than 4)
        .replace(/(\n){5,}/g, '\n\n\n\n')
        // Clean up any remaining standalone header tags
        .replace(/<\/?h[1-6][^>]*>/gi, '')
    }));
    
    return variations;
  }

  // Helper function to generate emails with Claude Sonnet 4.5 (newer model)
  async function generateEmailsWithClaudeSonnet45(
    productName: string,
    productDetails: any,
    manualContent: string,
    toneAngle: string,
    customTone: string,
    offerType: string,
    offerLink: string,
    winnerExamplesSection: string,
    toneSystemPrompts: Record<string, string>,
    toneUserPrompts: Record<string, string>
  ) {
    console.log("Claude Sonnet 4.5 manualContent length:", manualContent?.length || 0);
    
    const systemPrompt = `${toneSystemPrompts[toneAngle] || toneSystemPrompts['legendary-copywriters']}

Requirements:
- Style CTAs as <a href="[LINK]" style="color:#0066cc">anchor text</a>

Return JSON:
{
  "variations": [
    {
      "subjects": ["subject1", "subject2", "subject3"],
      "body": "email body with HTML formatting"
    }
  ]
}`;

    const userPrompt = `${toneUserPrompts[toneAngle] || toneUserPrompts['legendary-copywriters']}

${manualContent}

${winnerExamplesSection}`;

    console.log("=== CLAUDE SONNET 4.5 USER PROMPT START ===");
    console.log(userPrompt.substring(0, 500) + "...");
    console.log("=== CLAUDE SONNET 4.5 USER PROMPT END ===");

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 20000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    });

    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    console.log("Claude Sonnet 4.5 raw response length:", rawContent.length);
    
    if (!rawContent) {
      throw new Error("Claude Sonnet 4.5 returned no content");
    }

    // Claude may wrap JSON in markdown code fences - extract the JSON
    let jsonContent = rawContent.trim();
    
    // Remove markdown code fences if present
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.replace(/^```json\s*\n/, '').replace(/\n```\s*$/, '');
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.replace(/^```\s*\n/, '').replace(/\n```\s*$/, '');
    }

    const result = JSON.parse(jsonContent);
    let variations = result.variations || [];
    
    // Clean up each variation
    variations = variations.map((v: any) => ({
      ...v,
      body: v.body
        // Convert markdown bold to HTML
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Convert markdown italic to HTML (single asterisk, not already part of bold)
        .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>')
        // Remove all header tags and their content
        .replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, '')
        // Remove excessive consecutive line breaks (more than 4)
        .replace(/(\n){5,}/g, '\n\n\n\n')
        // Clean up any remaining standalone header tags
        .replace(/<\/?h[1-6][^>]*>/gi, '')
    }));
    
    return variations;
  }

  // Generate 10 email variations using Claude Sonnet 4 and Claude Sonnet 4.5
  app.post("/api/generate-emails", async (req, res) => {
    try {
      const { productName, productDetails, toneAngle, customTone, offerType, offerLink, productId } = req.body;

      // Fetch the product to get the full manual content
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      
      const manualContent = product.manualContent;
      console.log("Manual content length:", manualContent?.length || 0);
      console.log("Manual content first 200 chars:", manualContent?.substring(0, 200) || "EMPTY");

      // Special handling for AI Enhanced tone - intelligent agent that learns from winners AND losers
      if (toneAngle === 'ai-enhanced') {
        console.log("AI Enhanced mode - fetching both winners and losers for intelligent analysis");
        
        // Fetch winners by offer type (up to 30 for comprehensive analysis)
        let winningEmails = await storage.getWinningEmailsByOfferType(offerType, 30);
        if (winningEmails.length === 0 && productId) {
          winningEmails = await storage.getWinningEmailsByProduct(productId, 30);
        }
        if (winningEmails.length === 0) {
          winningEmails = await storage.getWinningEmails(30);
        }
        
        // Fetch losers by offer type (up to 30 for comprehensive analysis)
        let losingEmails = await storage.getLosingEmailsByOfferType(offerType, 30);
        if (losingEmails.length === 0) {
          losingEmails = await storage.getLosingEmails(30);
        }
        
        console.log(`AI Enhanced: Found ${winningEmails.length} winners and ${losingEmails.length} losers`);
        
        // Build the intelligent analysis prompt
        const aiEnhancedSystemPrompt = `You are an expert email marketing AI agent. Your task is to analyze winning and losing email creatives, identify what works and what doesn't, and generate 5 high-converting email variations.

ANALYSIS PHASE:
First, carefully analyze the patterns in winning vs losing emails below. Consider:
- Subject line techniques that drive opens (curiosity, urgency, personalization)
- Body copy patterns that convert (storytelling, social proof, scarcity)
- CTA placement and phrasing
- Emotional triggers used
- Length and formatting differences
- What losing emails got wrong (weak hooks, unclear value, poor CTAs)

WINNING EMAILS (learn from these patterns):
${winningEmails.length > 0 ? winningEmails.map((email, idx) => `
===== WINNER ${idx + 1} =====
Subject Lines: ${email.subjects?.join(' | ') || email.subject || 'N/A'}
Full Email Body:
${email.body || 'N/A'}
===== END WINNER ${idx + 1} =====
`).join('\n') : 'No winning emails available yet - use proven direct response principles.'}

LOSING EMAILS (avoid these patterns):
${losingEmails.length > 0 ? losingEmails.map((email, idx) => `
===== LOSER ${idx + 1} =====
Subject Lines: ${email.subjects?.join(' | ') || email.subject || 'N/A'}
Full Email Body:
${email.body || 'N/A'}
===== END LOSER ${idx + 1} =====
`).join('\n') : 'No losing emails to analyze - avoid generic, salesy copy.'}

GENERATION PHASE:
Now generate 5 unique email variations that:
1. Incorporate winning patterns you identified
2. Explicitly avoid the mistakes from losing emails
3. Are tailored for the "${offerType}" offer type
4. Include compelling subject lines that drive opens
5. Use proven conversion techniques

Requirements:
- Style CTAs as <a href="[LINK]" style="color:#0066cc">anchor text</a>
- Each email should be distinct in approach while maintaining quality
- Focus on emotional triggers, clear value propositions, and strong CTAs

Return JSON:
{
  "variations": [
    {
      "subjects": ["subject1", "subject2", "subject3"],
      "body": "email body with HTML formatting"
    }
  ]
}`;

        const aiEnhancedUserPrompt = `Product: ${productName}
Offer Type: ${offerType}
Offer Link: ${offerLink}

Product Details:
${productDetails}

${manualContent ? `Additional Product Information:\n${manualContent.substring(0, 3000)}` : ''}

Based on your analysis of the winning and losing emails above, generate 5 high-converting email variations for this product. Apply the patterns that work and avoid the mistakes that don't.`;

        // Call both Claude models in parallel for AI Enhanced
        const [claudeSonnet45Result, claudeResult] = await Promise.all([
          (async () => {
            try {
              const response = await anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 8000,
                system: aiEnhancedSystemPrompt,
                messages: [{ role: "user", content: aiEnhancedUserPrompt }]
              });
              
              const textContent = response.content.find((block: any) => block.type === 'text');
              const rawText = textContent ? (textContent as any).text : '';
              const jsonMatch = rawText.match(/\{[\s\S]*"variations"[\s\S]*\}/);
              if (!jsonMatch) throw new Error("No valid JSON found");
              
              let variations = JSON.parse(jsonMatch[0]).variations || [];
              variations = variations.map((v: any) => ({
                ...v,
                body: v.body
                  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                  .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>')
                  .replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, '')
                  .replace(/(\n){5,}/g, '\n\n\n\n')
                  .replace(/<\/?h[1-6][^>]*>/gi, '')
              }));
              
              return { variations, provider: 'claude-sonnet-4.5', error: null };
            } catch (error: any) {
              console.error("Claude Sonnet 4.5 AI Enhanced error:", error);
              return { variations: [], provider: 'claude-sonnet-4.5', error: error?.message || 'Unknown error' };
            }
          })(),
          (async () => {
            try {
              const response = await anthropic.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 8000,
                system: aiEnhancedSystemPrompt,
                messages: [{ role: "user", content: aiEnhancedUserPrompt }]
              });
              
              const textContent = response.content.find((block: any) => block.type === 'text');
              const rawText = textContent ? (textContent as any).text : '';
              const jsonMatch = rawText.match(/\{[\s\S]*"variations"[\s\S]*\}/);
              if (!jsonMatch) throw new Error("No valid JSON found");
              
              let variations = JSON.parse(jsonMatch[0]).variations || [];
              variations = variations.map((v: any) => ({
                ...v,
                body: v.body
                  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                  .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>')
                  .replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, '')
                  .replace(/(\n){5,}/g, '\n\n\n\n')
                  .replace(/<\/?h[1-6][^>]*>/gi, '')
              }));
              
              return { variations, provider: 'claude-sonnet-4', error: null };
            } catch (error: any) {
              console.error("Claude Sonnet 4 AI Enhanced error:", error);
              return { variations: [], provider: 'claude-sonnet-4', error: error?.message || 'Unknown error' };
            }
          })()
        ]);

        console.log("AI Enhanced - Claude Sonnet 4.5 variations:", claudeSonnet45Result.variations.length);
        console.log("AI Enhanced - Claude Sonnet 4 variations:", claudeResult.variations.length);

        const sessionId = req.body.sessionId || crypto.randomUUID();
        const savePromises = [];
        
        for (const variation of claudeSonnet45Result.variations) {
          if (variation.subjects && variation.body) {
            savePromises.push(
              storage.createEmail({
                subjects: variation.subjects,
                subject: variation.subjects[0],
                body: variation.body,
                htmlBody: variation.body,
                productIds: [productId],
                aiProvider: 'claude-sonnet-4.5',
                tone: 'ai-enhanced',
                status: 'draft',
                sessionId,
              })
            );
          }
        }
        
        for (const variation of claudeResult.variations) {
          if (variation.subjects && variation.body) {
            savePromises.push(
              storage.createEmail({
                subjects: variation.subjects,
                subject: variation.subjects[0],
                body: variation.body,
                htmlBody: variation.body,
                productIds: [productId],
                aiProvider: 'claude-sonnet-4',
                tone: 'ai-enhanced',
                status: 'draft',
                sessionId,
              })
            );
          }
        }

        await Promise.all(savePromises);

        return res.json({
          success: true,
          claudeSonnet45Variations: claudeSonnet45Result.variations.map((v: any) => ({
            ...v,
            aiProvider: 'claude-sonnet-4.5'
          })),
          claudeVariations: claudeResult.variations.map((v: any) => ({
            ...v,
            aiProvider: 'claude-sonnet-4'
          })),
          sessionId,
          generationErrors: {
            claudeSonnet45: claudeSonnet45Result.error,
            claude: claudeResult.error
          },
          aiEnhanced: true,
          winnersAnalyzed: winningEmails.length,
          losersAnalyzed: losingEmails.length
        });
      }

      // Fetch winning emails to learn from (prioritize by offer type, then product, then global)
      let winningEmails = await storage.getWinningEmailsByOfferType(offerType, 5);
      
      // Fallback strategy if no offer-type winners exist
      if (winningEmails.length === 0 && productId) {
        // Try product-specific winners
        winningEmails = await storage.getWinningEmailsByProduct(productId, 5);
      }
      
      if (winningEmails.length === 0) {
        // Fallback to global winners
        winningEmails = await storage.getWinningEmails(5);
      }
      
      // Build winner examples section - simplified to not override tone
      let winnerExamplesSection = '';
      if (winningEmails.length > 0) {
        winnerExamplesSection = `
Past winning emails for reference (learn from what worked):
${winningEmails.map((email, idx) => `
${idx + 1}. ${email.subjects?.[0] || email.subject}
`).join('')}
`;
      }

      const toneSystemPrompts: Record<string, string> = {
        "legendary-copywriters": "Generate 5 emails in the voice of legendary copywriters.",
        "national-brands": "Generate 5 emails in the style of national outdoor/survival/political brands.",
        "high-performing": "Generate 5 high-performing direct response emails.",
        "current-events": "Generate 5 emails that tie the product to current events and news.",
        "you-won": "Generate 5 emails using a 'You Won!' angle.",
        "try-something-new": "Generate 5 emails using experimental/novel approaches.",
        "review-based": "Generate 5 review-based emails featuring social proof and customer testimonials.",
        "story-time": "Generate 5 story-based emails with relatable narratives.",
        "custom": `Generate 5 emails in this style: ${customTone}.`
      };

      const toneUserPrompts: Record<string, string> = {
        "legendary-copywriters": "Write 5 emails in the voice of legendary copywriters for this product:",
        "national-brands": "Write 5 emails in the style of national outdoor/survival/political brands for this product:",
        "high-performing": "Write 5 high-performing direct response emails for this product:",
        "current-events": "Write 5 emails that tie the product to current events and news for this product:",
        "you-won": "Write 5 emails using a 'You Won!' angle for this product:",
        "try-something-new": "Write 5 emails using experimental/novel approaches for this product:",
        "review-based": "Write 5 review-based emails featuring social proof and customer testimonials for this product:",
        "story-time": "Write 5 story-based emails with relatable narratives for this product:",
        "custom": `Write 5 emails in this style: ${customTone} for this product:`
      };

      // No offer strategy rules - removed per user request

      const systemMessage = `${toneSystemPrompts[toneAngle] || toneSystemPrompts['legendary-copywriters']}

Requirements:
- Style CTAs as <a href="[LINK]" style="color:#0066cc">anchor text</a>

Return JSON:
{
  "variations": [
    {
      "subjects": ["subject1", "subject2", "subject3"],
      "body": "email body with HTML formatting"
    }
  ]
}`;

      // Call both Claude Sonnet 4.5 and Claude Sonnet 4 in parallel for 10 total variations
      const [claudeSonnet45Result, claudeResult] = await Promise.all([
        // Claude Sonnet 4.5 generation (replacing GPT-5)
        (async () => {
          try {
            const variations = await generateEmailsWithClaudeSonnet45(
              productName,
              productDetails,
              manualContent,
              toneAngle,
              customTone,
              offerType,
              offerLink,
              winnerExamplesSection,
              toneSystemPrompts,
              toneUserPrompts
            );
            return {
              variations,
              provider: 'claude-sonnet-4.5',
              error: null
            };
          } catch (error: any) {
            console.error("Claude Sonnet 4.5 generation error:", error);
            return { variations: [], provider: 'claude-sonnet-4.5', error: error?.message || 'Unknown error' };
          }
        })(),
        // Claude Sonnet 4 generation
        (async () => {
          try {
            const variations = await generateEmailsWithClaude(
              productName,
              productDetails,
              manualContent,
              toneAngle,
              customTone,
              offerType,
              offerLink,
              winnerExamplesSection,
              toneSystemPrompts,
              toneUserPrompts
            );
            return {
              variations,
              provider: 'claude',
              error: null
            };
          } catch (error: any) {
            console.error("Claude generation error:", error);
            return { variations: [], provider: 'claude', error: error?.message || 'Unknown error' };
          }
        })()
      ]);

      console.log("Claude Sonnet 4.5 variations count:", claudeSonnet45Result.variations.length);
      console.log("Claude Sonnet 4 variations count:", claudeResult.variations.length);

      // Get or create sessionId for tracking this generation
      const sessionId = req.body.sessionId || crypto.randomUUID();
      
      // Auto-save all generated emails to database for background generation support
      const savePromises = [];
      
      // Save Claude Sonnet 4.5 variations
      for (const variation of claudeSonnet45Result.variations) {
        if (variation.subjects && variation.body) {
          savePromises.push(
            storage.createEmail({
              subject: variation.subjects[0],
              subjects: variation.subjects,
              body: variation.body,
              htmlBody: variation.body, // Body already has HTML formatting
              productIds: [productId],
              tone: toneAngle,
              status: 'auto-generated', // Mark as auto-generated (not manually saved)
              sessionId,
              aiProvider: 'claude-sonnet-4.5'
            })
          );
        }
      }
      
      // Save Claude Sonnet 4 variations
      for (const variation of claudeResult.variations) {
        if (variation.subjects && variation.body) {
          savePromises.push(
            storage.createEmail({
              subject: variation.subjects[0],
              subjects: variation.subjects,
              body: variation.body,
              htmlBody: variation.body, // Body already has HTML formatting
              productIds: [productId],
              tone: toneAngle,
              status: 'auto-generated', // Mark as auto-generated (not manually saved)
              sessionId,
              aiProvider: 'claude-sonnet-4'
            })
          );
        }
      }
      
      // Save all emails to database (don't await - let it happen in background)
      Promise.all(savePromises).catch(err => {
        console.error("Failed to auto-save generated emails:", err);
      });

      // Return both sets of variations with provider labels and sessionId
      res.json({ 
        success: true, 
        sessionId, // Include sessionId so frontend can track this generation
        claudeSonnet45Variations: claudeSonnet45Result.variations,
        claudeVariations: claudeResult.variations,
        errors: {
          claudeSonnet45: claudeSonnet45Result.error,
          claude: claudeResult.error
        }
      });
    } catch (error) {
      console.error("Error generating emails:", error);
      res.status(500).json({ success: false, error: "Failed to generate emails" });
    }
  });

  // Fetch emails by session ID (for background generation recovery)
  app.get("/api/emails/session/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const emails = await storage.getEmailsBySession(sessionId);
      
      res.json({
        success: true,
        emails
      });
    } catch (error) {
      console.error("Error fetching emails by session:", error);
      res.status(500).json({ success: false, error: "Failed to fetch emails" });
    }
  });

  // Reuse email creative for a new product
  app.post("/api/reuse-email", async (req, res) => {
    try {
      const { emailId, productName, productDetails, offerType, offerLink } = req.body;

      // Fetch the original email
      const originalEmail = await storage.getEmail(emailId);
      if (!originalEmail) {
        return res.status(404).json({ success: false, error: "Original email not found" });
      }

      console.log("Reusing email:", emailId, "for product:", productName);

      // Use AI to adapt the creative for the new product
      const systemMessage = `You are adapting an existing email creative for a new product.

CRITICAL RULES:
1. PRESERVE the writing style, tone, structure, and creative approach of the original email
2. KEEP the same email length (within 10 words)
3. MAINTAIN the same paragraph structure and spacing
4. SWAP OUT product-specific details:
   - Product name
   - Retail price/value
   - Features and benefits (use new product's features but in same style)
   - Links (use new product link)
5. KEEP the creative angles, hooks, and persuasion techniques identical
6. Use SECOND PERSON (you, your, you're)
7. Include 2+ CTAs as: <a href="${offerLink}" style="color:#0066cc">Natural text</a>
8. Use <strong>bold</strong>, <em>italic</em>, and <u>underline</u> for emphasis in the same way as original
9. Use exactly 3 line breaks (\\n\\n\\n) between paragraphs

Return JSON with this format:
{
  "subjects": ["subject1", "subject2", "subject3"],
  "body": "adapted email body with formatting"
}`;

      const userMessage = `ORIGINAL EMAIL:
Subject options: ${JSON.stringify(originalEmail.subjects || [originalEmail.subject])}
Body: ${originalEmail.body}

NEW PRODUCT TO ADAPT FOR:
Product: ${productName}
Offer Type: ${offerType}
Link: ${offerLink}
Price: ${productDetails.price || 'N/A'}
Sale Price: ${productDetails.salePrice || 'N/A'}
Features: ${productDetails.features?.join(', ') || 'N/A'}
Benefits: ${productDetails.sellingPoints?.join(', ') || 'N/A'}
Target Audience: ${productDetails.targetAudience || 'N/A'}
${productDetails.urgency ? `Urgency: ${productDetails.urgency}` : ''}

${offerType === 'free-plus-shipping' ? `IMPORTANT: This is a F+S offer. MUST prominently reference the ${productDetails.price} retail value since customers get it FREE (only paying shipping).` : ''}

Adapt the original email for this new product. Keep the same creative style and structure, but swap in the new product details naturally.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: systemMessage
          },
          {
            role: "user",
            content: userMessage
          }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 10000
      });

      console.log("Reuse completion object:", JSON.stringify(completion, null, 2));
      console.log("Reuse finish reason:", completion.choices[0].finish_reason);
      
      const rawContent = completion.choices[0].message.content;
      console.log("Reuse AI response:", rawContent);

      if (!rawContent) {
        console.error("AI returned no content! Full completion:", completion);
        return res.json({ success: false, error: "AI returned no content" });
      }

      const result = JSON.parse(rawContent);
      
      if (!result.subjects || !result.body) {
        return res.json({ success: false, error: "Invalid response format" });
      }

      res.json({ success: true, email: result });
    } catch (error) {
      console.error("Error reusing email:", error);
      res.status(500).json({ success: false, error: "Failed to reuse email" });
    }
  });

  // Generate bump copy using both GPT-5 and Claude
  app.post("/api/generate-bump-copy", async (req, res) => {
    try {
      // Validate request body
      const bumpSchema = z.object({
        productName: z.string().min(1, "Product name is required"),
        productInfo: z.string().min(10, "Product info must be at least 10 characters"),
        retailPrice: z.string().min(1, "Retail price is required"),
        salePrice: z.string().min(1, "Sale price is required"),
      });

      const validation = bumpSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          success: false, 
          error: "Invalid input", 
          details: validation.error.errors 
        });
      }

      const { productName, productInfo, retailPrice, salePrice } = validation.data;

      console.log("Generating bump copy for:", productName);
      console.log("Retail:", retailPrice, "Sale:", salePrice);

      const systemPrompt = `Create 5 versions of high-performing ClickFunnels bump copy for the following product. Each version should have 3 different headlines to choose from. Ignore the price details in the product info, only utilize the retail Price and sale price field below. Your output should reflect the user on an order form buying a separate product, and this is a one-time offer for the product below. The CTAs can be phrases like "Grab Your [retail] [product] for just [sale price]", "Click the checkbox to add your [product name] for just [sale price]", etc. and the actual way to add it is by clicking a checkbox. Utilize scarcity in some of the versions.

Return JSON:
{
  "variations": [
    {
      "headlines": ["headline1", "headline2", "headline3"],
      "body": "bump copy body with HTML formatting"
    }
  ]
}`;

      const userPrompt = `Product Name: ${productName}
Retail Price: ${retailPrice}
Sale Price: ${salePrice}

Product Info:
${productInfo}`;

      console.log("=== BUMP SYSTEM PROMPT ===");
      console.log(systemPrompt);
      console.log("=== BUMP USER PROMPT ===");
      console.log(userPrompt);

      // Call both GPT-5 and Claude in parallel
      const [gptResult, claudeResult] = await Promise.all([
        // GPT-5 generation
        (async () => {
          try {
            const completion = await openai.chat.completions.create({
              model: "gpt-5",
              messages: [
                {
                  role: "system",
                  content: systemPrompt
                },
                {
                  role: "user",
                  content: userPrompt
                }
              ],
              response_format: { type: "json_object" },
              max_completion_tokens: 10000
            });

            const rawContent = completion.choices[0].message.content;
            console.log("GPT-5 bump response:", rawContent);
            
            if (!rawContent) {
              return { variations: [], provider: 'gpt-5', error: 'No content' };
            }

            // Parse JSON (handle potential markdown wrappers)
            let jsonContent = rawContent.trim();
            if (jsonContent.startsWith('```json')) {
              jsonContent = jsonContent.replace(/^```json\s*\n/, '').replace(/\n```\s*$/, '');
            } else if (jsonContent.startsWith('```')) {
              jsonContent = jsonContent.replace(/^```\s*\n/, '').replace(/\n```\s*$/, '');
            }

            const result = JSON.parse(jsonContent);
            const variations = result.variations || [];
            
            // Validate each variation has 3 headlines and body
            const validVariations = variations.filter((v: any) => {
              const hasHeadlines = Array.isArray(v.headlines) && v.headlines.length === 3;
              const hasBody = typeof v.body === 'string' && v.body.length > 0;
              if (!hasHeadlines || !hasBody) {
                console.warn("GPT-5 returned malformed variation:", v);
              }
              return hasHeadlines && hasBody;
            });
            
            if (validVariations.length < variations.length) {
              console.warn(`GPT-5: ${variations.length - validVariations.length} malformed variations filtered out`);
            }
            
            let error = null;
            if (validVariations.length === 0) {
              error = 'All variations were malformed';
            } else if (validVariations.length < 5) {
              error = `Only ${validVariations.length} of 5 variations passed validation. Some variations had malformed structure.`;
            }
            
            return { 
              variations: validVariations, 
              provider: 'gpt-5',
              error
            };
          } catch (error: any) {
            console.error("GPT-5 bump generation error:", error);
            return { variations: [], provider: 'gpt-5', error: error?.message || 'Unknown error' };
          }
        })(),
        // Claude generation
        (async () => {
          try {
            const message = await anthropic.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 10000,
              system: systemPrompt,
              messages: [
                {
                  role: "user",
                  content: userPrompt
                }
              ]
            });

            const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
            console.log("Claude bump response:", rawContent);
            
            if (!rawContent) {
              throw new Error("Claude returned no content");
            }

            // Parse JSON (handle potential markdown wrappers)
            let jsonContent = rawContent.trim();
            if (jsonContent.startsWith('```json')) {
              jsonContent = jsonContent.replace(/^```json\s*\n/, '').replace(/\n```\s*$/, '');
            } else if (jsonContent.startsWith('```')) {
              jsonContent = jsonContent.replace(/^```\s*\n/, '').replace(/\n```\s*$/, '');
            }

            const result = JSON.parse(jsonContent);
            const variations = result.variations || [];
            
            // Validate each variation has 3 headlines and body
            const validVariations = variations.filter((v: any) => {
              const hasHeadlines = Array.isArray(v.headlines) && v.headlines.length === 3;
              const hasBody = typeof v.body === 'string' && v.body.length > 0;
              if (!hasHeadlines || !hasBody) {
                console.warn("Claude returned malformed variation:", v);
              }
              return hasHeadlines && hasBody;
            });
            
            if (validVariations.length < variations.length) {
              console.warn(`Claude: ${variations.length - validVariations.length} malformed variations filtered out`);
            }
            
            let error = null;
            if (validVariations.length === 0) {
              error = 'All variations were malformed';
            } else if (validVariations.length < 5) {
              error = `Only ${validVariations.length} of 5 variations passed validation. Some variations had malformed structure.`;
            }
            
            return {
              variations: validVariations,
              provider: 'claude',
              error
            };
          } catch (error: any) {
            console.error("Claude bump generation error:", error);
            return { variations: [], provider: 'claude', error: error?.message || 'Unknown error' };
          }
        })()
      ]);

      console.log("GPT-5 bump variations count:", gptResult.variations.length);
      console.log("Claude bump variations count:", claudeResult.variations.length);

      // Return both sets of variations
      res.json({ 
        success: true, 
        gptVariations: gptResult.variations,
        claudeVariations: claudeResult.variations,
        errors: {
          gpt: gptResult.error,
          claude: claudeResult.error
        }
      });
    } catch (error) {
      console.error("Error generating bump copy:", error);
      res.status(500).json({ success: false, error: "Failed to generate bump copy" });
    }
  });

  // Generate SMS/MMS campaigns
  app.post("/api/generate-sms", async (req, res) => {
    try {
      const { brand, productId, angle } = req.body;

      if (!brand || !productId) {
        return res.status(400).json({ success: false, error: "Brand and product are required" });
      }

      // Fetch product details
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }

      // Calculate brand prefix length for character counting
      const brandPrefix = `${brand}: `;
      const brandPrefixLength = brandPrefix.length;

      // Create prompt for SMS generation
      const smsPrompt = `Create high-performing marketing SMS/MMS campaigns for this product.

Brand: ${brand}
Product: ${product.name}
Offer Type: ${product.offerType}
${angle ? `Angle/Style: ${angle}` : ''}

Sales Page Content:
${product.manualContent}

Generate 5 variations:
- 3 SMS messages (max 160 characters after tag conversions and brand prefix)
- 2 MMS messages (max 1,600 characters after tag conversions and brand prefix)

CRITICAL FORMATTING RULES:
1. EVERY message MUST start with "${brand}: " (this is ${brandPrefixLength} characters)
2. EVERY message MUST end with " Reply Stop To Stop" (this is 19 characters including the leading space)
3. Use {productUrl} for product links - this will convert to "https://mtpdls.com/xxxxx" (24 chars)
4. VARY personalization - only use {firstName} in SOME messages (not all). Mix it up! (11 chars when used)
5. Use {state} for location personalization when relevant - stays as {state} (7 chars)
6. Count: brand prefix (${brandPrefixLength} chars) + "Reply Stop To Stop" (19 chars) + tag lengths!
7. Make messages compelling, urgent, and action-oriented
8. Include clear CTAs
9. Use second-person writing (you/your)
10. Make each variation unique in approach and personalization style

Example formats:
- "${brand}: Hey {firstName}! Check out {productUrl} for an exclusive offer! Reply Stop To Stop"
- "${brand}: Don't miss this deal: {productUrl} - Limited time only! Reply Stop To Stop"
- "${brand}: Exclusive for {state} residents: {productUrl} Reply Stop To Stop"

Return ONLY a valid JSON array with this exact format:
[
  {
    "type": "sms",
    "message": "${brand}: Your SMS message here with {productUrl} Reply Stop To Stop"
  },
  ...
]

No explanations, no markdown formatting, just the raw JSON array.`;

      // Call both Claude and GPT-5 in parallel
      const [claudeResult, gptResult] = await Promise.all([
        // Claude generation
        (async () => {
          try {
            console.log("Calling Claude for SMS generation...");
            
            const response = await anthropic.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4096,
              messages: [{
                role: "user",
                content: smsPrompt
              }]
            });

            const content = response.content[0];
            if (content.type !== 'text') {
              throw new Error('Unexpected Claude response format');
            }

            const rawText = content.text.trim();
            const jsonMatch = rawText.match(/\[[\s\S]*\]/);
            const jsonText = jsonMatch ? jsonMatch[0] : rawText;
            
            const variations = JSON.parse(jsonText);
            
            if (!Array.isArray(variations)) {
              throw new Error('Invalid response format from Claude');
            }

            // Calculate character counts with tag conversions
            const processedVariations = variations.map((v: any) => {
              const converted = v.message
                .replace(/\{productUrl\}/g, 'https://mtpdls.com/xxxxx')
                .replace(/\{firstName\}/g, '{firstName}')
                .replace(/\{state\}/g, '{state}');
              
              return {
                ...v,
                characterCount: converted.length,
                aiProvider: 'claude'
              };
            });

            console.log("Claude generated", processedVariations.length, "SMS variations");
            return { variations: processedVariations, provider: 'claude', error: null };
          } catch (error: any) {
            console.error("Claude SMS generation error:", error);
            return { variations: [], provider: 'claude', error: error?.message || 'Unknown error' };
          }
        })(),

        // GPT-5 generation
        (async () => {
          try {
            console.log("Calling GPT-5 for SMS generation...");
            
            const response = await openai.chat.completions.create({
              model: "gpt-5",
              messages: [{
                role: "user",
                content: smsPrompt
              }],
              // GPT-5 only supports default temperature (1), custom values not allowed
            });

            const rawText = response.choices[0]?.message?.content?.trim() || '';
            const jsonMatch = rawText.match(/\[[\s\S]*\]/);
            const jsonText = jsonMatch ? jsonMatch[0] : rawText;
            
            const variations = JSON.parse(jsonText);
            
            if (!Array.isArray(variations)) {
              throw new Error('Invalid response format from GPT-5');
            }

            // Calculate character counts with tag conversions
            const processedVariations = variations.map((v: any) => {
              const converted = v.message
                .replace(/\{productUrl\}/g, 'https://mtpdls.com/xxxxx')
                .replace(/\{firstName\}/g, '{firstName}')
                .replace(/\{state\}/g, '{state}');
              
              return {
                ...v,
                characterCount: converted.length,
                aiProvider: 'gpt'
              };
            });

            console.log("GPT-5 generated", processedVariations.length, "SMS variations");
            return { variations: processedVariations, provider: 'gpt', error: null };
          } catch (error: any) {
            console.error("GPT-5 SMS generation error:", error);
            return { variations: [], provider: 'gpt', error: error?.message || 'Unknown error' };
          }
        })()
      ]);

      console.log("Claude SMS variations count:", claudeResult.variations.length);
      console.log("GPT-5 SMS variations count:", gptResult.variations.length);

      // Return both sets of variations
      res.json({ 
        success: true, 
        claudeVariations: claudeResult.variations,
        gptVariations: gptResult.variations,
        errors: {
          claude: claudeResult.error,
          gpt: gptResult.error
        }
      });
    } catch (error) {
      console.error("Error generating SMS:", error);
      res.status(500).json({ success: false, error: "Failed to generate SMS" });
    }
  });

  // Save email to library
  app.post("/api/emails", async (req, res) => {
    try {
      const emailData = req.body;
      
      // Convert ISO string timestamps to Date objects
      if (emailData.editedAt && typeof emailData.editedAt === 'string') {
        emailData.editedAt = new Date(emailData.editedAt);
      }
      
      const savedEmail = await storage.createEmail(emailData);
      res.json({ success: true, email: savedEmail });
    } catch (error) {
      console.error("Error saving email:", error);
      res.status(500).json({ success: false, error: "Failed to save email" });
    }
  });

  // Get all emails from library (with optional pagination)
  app.get("/api/emails", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 30;
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;
      
      // If pagination parameters are provided, use paginated query
      if (req.query.page || req.query.limit) {
        const result = await storage.getEmailsPaginated({ 
          page, 
          limit, 
          search, 
          status 
        });
        res.json({ success: true, ...result });
      } else {
        // Fallback to original behavior for backward compatibility
        const emails = await storage.getEmails();
        res.json({ success: true, emails });
      }
    } catch (error) {
      console.error("Error fetching emails:", error);
      res.status(500).json({ success: false, error: "Failed to fetch emails" });
    }
  });

  // Get single email by ID
  app.get("/api/emails/:id", async (req, res) => {
    try {
      const email = await storage.getEmail(req.params.id);
      if (!email) {
        return res.status(404).json({ success: false, error: "Email not found" });
      }
      res.json({ success: true, email });
    } catch (error) {
      console.error("Error fetching email:", error);
      res.status(500).json({ success: false, error: "Failed to fetch email" });
    }
  });

  // Update email
  app.patch("/api/emails/:id", async (req, res) => {
    try {
      const updatedEmail = await storage.updateEmail(req.params.id, req.body);
      if (!updatedEmail) {
        return res.status(404).json({ success: false, error: "Email not found" });
      }
      res.json({ success: true, email: updatedEmail });
    } catch (error) {
      console.error("Error updating email:", error);
      res.status(500).json({ success: false, error: "Failed to update email" });
    }
  });

  // Delete email
  app.delete("/api/emails/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteEmail(req.params.id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: "Email not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting email:", error);
      res.status(500).json({ success: false, error: "Failed to delete email" });
    }
  });

  // Create product
  app.post("/api/products", async (req, res) => {
    try {
      const productData = req.body;
      const savedProduct = await storage.createProduct(productData);
      res.json({ success: true, product: savedProduct });
    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({ success: false, error: "Failed to create product" });
    }
  });

  // Get all products (with optional pagination)
  app.get("/api/products", async (req, res) => {
    try {
      const { page, limit, search, offerType } = req.query;
      
      // If pagination params are provided, use paginated endpoint
      if (page && limit) {
        const pageNum = parseInt(page as string, 10);
        const limitNum = parseInt(limit as string, 10);
        
        if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
          return res.status(400).json({ 
            success: false, 
            error: "Invalid page or limit parameters" 
          });
        }
        
        const result = await storage.getProductsPaginated({
          page: pageNum,
          limit: limitNum,
          search: search as string | undefined,
          offerType: offerType as string | undefined
        });
        
        return res.json({ success: true, ...result });
      }
      
      // Otherwise, return all products (backwards compatibility)
      const products = await storage.getProducts();
      res.json({ success: true, products });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ success: false, error: "Failed to fetch products" });
    }
  });

  // Get single product by ID
  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      res.json({ success: true, product });
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ success: false, error: "Failed to fetch product" });
    }
  });

  // Update product
  app.patch("/api/products/:id", async (req, res) => {
    try {
      // Exclude createdAt and id from update (these should never be changed)
      const { createdAt, id, ...updateData } = req.body;
      const updatedProduct = await storage.updateProduct(req.params.id, updateData);
      if (!updatedProduct) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      res.json({ success: true, product: updatedProduct });
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({ success: false, error: "Failed to update product" });
    }
  });

  // Delete product
  app.delete("/api/products/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteProduct(req.params.id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ success: false, error: "Failed to delete product" });
    }
  });

  // Rate Limit endpoints - Track and manage video generation model rate limits
  app.get("/api/rate-limits", async (req, res) => {
    try {
      // Get all rate limits
      const limits = await storage.getRateLimits();
      
      // Auto-reset any expired limits
      const now = new Date();
      for (const limit of limits) {
        if (limit.isCapped === 1 && limit.resetsAt && limit.resetsAt <= now) {
          await storage.markModelCapped(limit.modelName); // This will update the reset time
          // Actually reset it
          await storage.resetRateLimits();
        }
      }
      
      // Fetch updated limits
      const updatedLimits = await storage.getRateLimits();
      
      res.json({ success: true, rateLimits: updatedLimits });
    } catch (error) {
      console.error("Error fetching rate limits:", error);
      res.status(500).json({ success: false, error: "Failed to fetch rate limits" });
    }
  });

  app.post("/api/rate-limits/mark-capped", async (req, res) => {
    try {
      const { modelName } = req.body;
      
      if (!modelName) {
        return res.status(400).json({ success: false, error: "Model name is required" });
      }
      
      console.log(`[Rate Limit] Marking ${modelName} as capped until 3:00 AM EST`);
      
      const rateLimit = await storage.markModelCapped(modelName);
      
      res.json({ success: true, rateLimit });
    } catch (error) {
      console.error("Error marking model as capped:", error);
      res.status(500).json({ success: false, error: "Failed to mark model as capped" });
    }
  });

  app.post("/api/rate-limits/reset", async (req, res) => {
    try {
      await storage.resetRateLimits();
      const updatedLimits = await storage.getRateLimits();
      
      console.log("[Rate Limit] All rate limits have been reset");
      
      res.json({ success: true, rateLimits: updatedLimits });
    } catch (error) {
      console.error("Error resetting rate limits:", error);
      res.status(500).json({ success: false, error: "Failed to reset rate limits" });
    }
  });

  // Get available video models with rate limit status
  app.get("/api/video-models", async (req, res) => {
    try {
      const generationType = req.query.generationType as GenerationType | undefined;
      
      // Get all rate limits
      const rateLimits = await storage.getRateLimits();
      const now = new Date();
      
      // Create a map of model rate limit status
      const rateLimitMap = new Map<string, { isCapped: boolean; resetsAt: Date | null }>();
      for (const limit of rateLimits) {
        const isCapped = limit.isCapped === 1 && limit.resetsAt && limit.resetsAt > now;
        rateLimitMap.set(limit.modelName, {
          isCapped: !!isCapped,
          resetsAt: isCapped ? limit.resetsAt : null
        });
      }
      
      // Get models (optionally filtered by generation type)
      let models = generationType 
        ? getModelsForGenerationType(generationType)
        : Object.values(VIDEO_MODELS).sort((a, b) => a.displayOrder - b.displayOrder);
      
      // Combine model definitions with rate limit status
      const modelsWithAvailability = models.map(model => {
        const rateLimitStatus = rateLimitMap.get(model.id);
        const isCapped = rateLimitStatus?.isCapped ?? false;
        
        return {
          ...model,
          isAvailable: !isCapped,
          unavailableUntil: isCapped ? rateLimitStatus?.resetsAt?.toISOString() : null,
          unavailableMessage: isCapped 
            ? `Unavailable until 3:00 AM EST (${rateLimitStatus?.resetsAt?.toLocaleString('en-US', { timeZone: 'America/New_York' })})`
            : null
        };
      });
      
      res.json({ 
        success: true, 
        models: modelsWithAvailability,
        generationTypes: GENERATION_TYPE_CONFIGS
      });
    } catch (error) {
      console.error("Error fetching video models:", error);
      res.status(500).json({ success: false, error: "Failed to fetch video models" });
    }
  });

  // Analytics endpoint for specific offer type - Calculate performance metrics filtered by offer type
  app.get("/api/analytics/offer-type/:offerType", async (req, res) => {
    try {
      const targetOfferType = req.params.offerType;
      const allEmails = await storage.getEmails();
      const allProducts = await storage.getProducts();

      // Filter emails to only those associated with products of the target offer type
      const filteredEmails = allEmails.filter(email => {
        const emailProducts = allProducts.filter(p => email.productIds.includes(p.id));
        return emailProducts.some(p => p.offerType === targetOfferType);
      });

      // Calculate overall stats for this offer type
      const totalEmails = filteredEmails.length;
      const winnerCount = filteredEmails.filter(e => e.status === 'winner').length;
      const loserCount = filteredEmails.filter(e => e.status === 'loser').length;
      const testingCount = filteredEmails.filter(e => e.status === 'testing').length;
      const needsTestingCount = filteredEmails.filter(e => e.status === 'needs-testing').length;
      const tested = winnerCount + loserCount;
      const overallWinRate = tested > 0 ? Math.round((winnerCount / tested) * 100) : 0;

      // Calculate win rate by tone (for this offer type only)
      const toneStats: Record<string, { total: number; winners: number; losers: number; winRate: number }> = {};
      
      filteredEmails.forEach(email => {
        const tone = email.tone || 'unknown';
        if (!toneStats[tone]) {
          toneStats[tone] = { total: 0, winners: 0, losers: 0, winRate: 0 };
        }
        toneStats[tone].total++;
        if (email.status === 'winner') toneStats[tone].winners++;
        if (email.status === 'loser') toneStats[tone].losers++;
      });

      // Calculate win rates (only for tones with at least one tested email)
      Object.keys(toneStats).forEach(tone => {
        const tested = toneStats[tone].winners + toneStats[tone].losers;
        toneStats[tone].winRate = tested > 0 
          ? Math.round((toneStats[tone].winners / tested) * 100) 
          : 0;
      });

      // Find top performing tone for this offer type
      const topTone = Object.entries(toneStats)
        .filter(([_, stats]) => (stats.winners + stats.losers) >= 3) // At least 3 tested
        .sort((a, b) => b[1].winRate - a[1].winRate)[0];

      // Recent winners for this offer type
      const recentWinners = filteredEmails
        .filter(e => e.status === 'winner')
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
        .slice(0, 5);

      const analytics = {
        offerType: targetOfferType,
        overall: {
          total: totalEmails,
          winners: winnerCount,
          losers: loserCount,
          testing: testingCount,
          needsTesting: needsTestingCount,
          tested,
          winRate: overallWinRate,
        },
        byTone: toneStats,
        topPerformer: topTone ? { tone: topTone[0], winRate: topTone[1].winRate } : null,
        recentWinners,
      };

      res.json({ success: true, analytics });
    } catch (error) {
      console.error("Error calculating offer-type analytics:", error);
      res.status(500).json({ success: false, error: "Failed to calculate analytics" });
    }
  });

  // Analytics endpoint - Calculate performance metrics
  app.get("/api/analytics", async (req, res) => {
    try {
      const allEmails = await storage.getEmails();
      const allProducts = await storage.getProducts();

      // Calculate overall stats
      const totalEmails = allEmails.length;
      const winnerCount = allEmails.filter(e => e.status === 'winner').length;
      const loserCount = allEmails.filter(e => e.status === 'loser').length;
      const testingCount = allEmails.filter(e => e.status === 'testing').length;
      const needsTestingCount = allEmails.filter(e => e.status === 'needs-testing').length;

      // Calculate win rate by tone
      const toneStats: Record<string, { total: number; winners: number; losers: number; winRate: number }> = {};
      
      allEmails.forEach(email => {
        const tone = email.tone || 'unknown';
        if (!toneStats[tone]) {
          toneStats[tone] = { total: 0, winners: 0, losers: 0, winRate: 0 };
        }
        toneStats[tone].total++;
        if (email.status === 'winner') toneStats[tone].winners++;
        if (email.status === 'loser') toneStats[tone].losers++;
      });

      // Calculate win rates (only for tones with at least one tested email)
      Object.keys(toneStats).forEach(tone => {
        const tested = toneStats[tone].winners + toneStats[tone].losers;
        toneStats[tone].winRate = tested > 0 
          ? Math.round((toneStats[tone].winners / tested) * 100) 
          : 0;
      });

      // Calculate win rate by offer type
      const offerTypeStats: Record<string, { total: number; winners: number; losers: number; winRate: number }> = {};
      
      allEmails.forEach(email => {
        // Find the product(s) associated with this email
        const emailProducts = allProducts.filter(p => email.productIds.includes(p.id));
        
        emailProducts.forEach(product => {
          const offerType = product.offerType || 'unknown';
          if (!offerTypeStats[offerType]) {
            offerTypeStats[offerType] = { total: 0, winners: 0, losers: 0, winRate: 0 };
          }
          // Only count each email once per offer type (even if multiple products)
          const alreadyCounted = offerTypeStats[offerType].total;
          if (!alreadyCounted || !email.productIds.some(id => {
            const p = allProducts.find(prod => prod.id === id && prod.offerType === offerType);
            return p && allProducts.indexOf(p) < emailProducts.indexOf(product);
          })) {
            offerTypeStats[offerType].total++;
            if (email.status === 'winner') offerTypeStats[offerType].winners++;
            if (email.status === 'loser') offerTypeStats[offerType].losers++;
          }
        });
      });

      // Calculate win rates for offer types
      Object.keys(offerTypeStats).forEach(offerType => {
        const tested = offerTypeStats[offerType].winners + offerTypeStats[offerType].losers;
        offerTypeStats[offerType].winRate = tested > 0 
          ? Math.round((offerTypeStats[offerType].winners / tested) * 100) 
          : 0;
      });

      // Find top performing tone
      const topTone = Object.entries(toneStats)
        .filter(([_, stats]) => (stats.winners + stats.losers) >= 3) // At least 3 tested
        .sort((a, b) => b[1].winRate - a[1].winRate)[0];

      // Recent winners for display
      const recentWinners = allEmails
        .filter(e => e.status === 'winner')
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
        .slice(0, 5);

      res.json({
        success: true,
        analytics: {
          overall: {
            totalEmails,
            winners: winnerCount,
            losers: loserCount,
            testing: testingCount,
            needsTesting: needsTestingCount,
            overallWinRate: (winnerCount + loserCount) > 0 
              ? Math.round((winnerCount / (winnerCount + loserCount)) * 100) 
              : 0,
          },
          byTone: toneStats,
          byOfferType: offerTypeStats,
          topPerformer: topTone ? {
            tone: topTone[0],
            winRate: topTone[1].winRate,
            tested: topTone[1].winners + topTone[1].losers,
          } : null,
          recentWinners: recentWinners.map(w => ({
            id: w.id,
            subject: w.subjects?.[0] || w.subject,
            tone: w.tone,
            createdAt: w.createdAt,
          })),
        },
      });
    } catch (error) {
      console.error("Error calculating analytics:", error);
      res.status(500).json({ success: false, error: "Failed to calculate analytics" });
    }
  });

  // Generate image suggestions based on product (with streaming for faster perceived performance)
  app.post("/api/generate-image-suggestions", async (req, res) => {
    try {
      const { productId } = req.body;

      if (!productId || productId === 'none') {
        return res.status(400).json({
          success: false,
          error: "Product selection is required for suggestions"
        });
      }

      // Get product details
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found"
        });
      }

      console.log("Generating image suggestions for product:", product.name);
      console.log("Product offer link:", product.offerLink);

      // Build prompt for Claude Sonnet 4 to generate suggestions
      const prompt = `You are an expert marketing image strategist. Analyze this product and generate creative, specific image suggestions.

Product: ${product.name}
${product.offerLink ? `Offer Link: ${product.offerLink}` : ''}
${product.manualContent ? `Product Details: ${product.manualContent.substring(0, 500)}` : ''}

Generate exactly 3 concise, actionable image prompts for each category:

1. LIFESTYLE - Real-world use, emotional context, aspirational scenarios
2. PRODUCT - Professional photography, detail shots, feature highlights
3. UGC - User-generated style, authentic, relatable, less polished
4. REVIEW - Testimonial style, before/after, comparison, proof elements

Each prompt should be specific and ready for image generation. Consider the product's use case, features, and target audience.

Return ONLY valid JSON:
{
  "lifestyle": ["prompt 1", "prompt 2", "prompt 3"],
  "product": ["prompt 1", "prompt 2", "prompt 3"],
  "ugc": ["prompt 1", "prompt 2", "prompt 3"],
  "review": ["prompt 1", "prompt 2", "prompt 3"]
}`;

      console.log("Calling Claude Sonnet 4 for image suggestions with streaming...");
      
      // Set headers for Server-Sent Events (with anti-buffering headers)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
      
      // Send immediate start message so user sees activity right away
      res.write(`data: ${JSON.stringify({ type: 'progress', content: 'Starting AI generation...\n' })}\n\n`);
      
      let accumulatedContent = '';
      
      // Stream the response from Claude
      const stream = await anthropic.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      // Process the stream
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          accumulatedContent += chunk.delta.text;
          
          // Send progress update to client
          res.write(`data: ${JSON.stringify({ type: 'progress', content: chunk.delta.text })}\n\n`);
        }
      }

      console.log("Claude image suggestions streaming completed");
      
      // Strip markdown code fences if present
      let rawContent = accumulatedContent.trim();
      if (rawContent.startsWith('```json')) {
        rawContent = rawContent.slice(7);
      } else if (rawContent.startsWith('```')) {
        rawContent = rawContent.slice(3);
      }
      if (rawContent.endsWith('```')) {
        rawContent = rawContent.slice(0, -3);
      }
      rawContent = rawContent.trim();

      const suggestions = JSON.parse(rawContent);
      console.log("Generated image suggestion categories:", Object.keys(suggestions));

      // Send final complete result
      res.write(`data: ${JSON.stringify({ type: 'complete', suggestions })}\n\n`);
      res.end();
      
    } catch (error: any) {
      console.error("Error generating image suggestions:", error);
      
      // For SSE, we need to send error as an event
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: error.message || "Failed to generate image suggestions" 
        });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || 'Failed to generate image suggestions' })}\n\n`);
        res.end();
      }
    }
  });

  // Generate video suggestions based on product (with streaming for faster perceived performance)
  app.post("/api/generate-video-suggestions", async (req, res) => {
    try {
      const { productId } = req.body;

      if (!productId || productId === 'none') {
        return res.status(400).json({
          success: false,
          error: "Product selection is required for suggestions"
        });
      }

      // Get product details
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found"
        });
      }

      console.log("Generating video suggestions for product:", product.name);

      // Build detailed prompt for Claude Sonnet 4 to generate video-specific suggestions
      const prompt = `You are an expert video prompt engineer with a Master's degree in Marketing and 10+ years experience in commercial cinematography. Your specialty is creating detailed, conversion-optimized video prompts specifically formatted for AI video generators.

Generate 12 thorough video prompts for:

Product: ${product.name}
${product.offerLink ? `Offer Link: ${product.offerLink}` : ''}
${product.manualContent ? `Product Details: ${product.manualContent.substring(0, 8000)}` : ''}


CRITICAL CONSTRAINTS:
- Most AI-generated clips are 4-8 seconds long - optimize all prompts for this duration
- Available aspect ratios: 16:9 (horizontal) and 9:16 (vertical) ONLY
- Each prompt must specify exact duration between 4-8 seconds

STRUCTURE REQUIREMENTS:
- 4 distinct categories: (1) Lifestyle, (2) Product, (3) UGC Style, (4) Review
- 3 unique prompts per category (12 total)
- Each prompt must be 150-200 words (comprehensive and detailed)

MANDATORY ELEMENTS FOR EACH PROMPT:
1. **Title** (descriptive and angle-focused)
2. **Aspect Ratio:** (16:9 or 9:16) | **Duration:** (4-8 seconds - be specific)
3. **Scene Description** including:
   - Camera setup (static, slow push, handheld, orbital, etc.)
   - Lighting details (direction, quality, color temperature, motivation)
   - Depth of field (f-stop equivalent)
   - Frame rate (24fps, 60fps, 120fps, 180fps, 240fps with reasoning)
   - Shot composition (framing, angles, rule of thirds)
   - Color grading approach (specific LUT style, saturation, mood)
   - Action/movement details (what happens, timing, choreography)
   - Background and environment specifics
   - Sound design notes (even though AI may not generate audio)
   - Final frame description
4. **Marketing Rationale:** (1-2 sentences explaining conversion strategy and target audience)

CATEGORY-SPECIFIC REQUIREMENTS:

**LIFESTYLE (3 prompts):**
- Show product in aspirational real-world contexts
- Focus on emotional connection and identity
- Include human hands/interaction
- Build desire through lifestyle association
- Use cinematic techniques (24fps, shallow DOF, color grading)

**PRODUCT (3 prompts):**
- Pure product showcase on clean backgrounds
- Highlight specific features and build quality
- Use dramatic lighting and slow-motion (120-240fps)
- Technical and premium presentation
- Demonstrate mechanical action or key features

**UGC STYLE (3 prompts):**
- Authentic, relatable, imperfect aesthetic
- Handheld smartphone feel with slight shake
- Natural lighting (ring light, window, indoor ambient)
- Direct-to-camera energy or POV perspective
- Fast-paced editing style, jump cuts
- Optimized for social media platforms (primarily 9:16)

**REVIEW (3 prompts):**
- Credible, analytical, evidence-based
- Comparison tests or durability demonstrations
- Scientific presentation with controlled variables
- Clean backgrounds, even lighting for clarity
- Build trust through objective testing
- Show before/after or side-by-side results

Return ONLY valid JSON:
{
  "lifestyle": ["prompt 1", "prompt 2", "prompt 3"],
  "product": ["prompt 1", "prompt 2", "prompt 3"],
  "ugc": ["prompt 1", "prompt 2", "prompt 3"],
  "review": ["prompt 1", "prompt 2", "prompt 3"]
}`;

      console.log("Calling Claude Sonnet 4 for video suggestions with streaming...");
      
      // Set headers for Server-Sent Events (with anti-buffering headers)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
      
      // Send immediate start message so user sees activity right away
      res.write(`data: ${JSON.stringify({ type: 'progress', content: 'Starting AI generation...\n' })}\n\n`);
      
      let accumulatedContent = '';
      
      // Stream the response from Claude
      const stream = await anthropic.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      // Process the stream
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          accumulatedContent += chunk.delta.text;
          
          // Send progress update to client
          res.write(`data: ${JSON.stringify({ type: 'progress', content: chunk.delta.text })}\n\n`);
        }
      }

      console.log("Claude video suggestions streaming completed");
      
      // Strip markdown code fences if present
      let rawContent = accumulatedContent.trim();
      if (rawContent.startsWith('```json')) {
        rawContent = rawContent.slice(7);
      } else if (rawContent.startsWith('```')) {
        rawContent = rawContent.slice(3);
      }
      if (rawContent.endsWith('```')) {
        rawContent = rawContent.slice(0, -3);
      }
      rawContent = rawContent.trim();

      const suggestions = JSON.parse(rawContent);
      console.log("Generated video suggestion categories:", Object.keys(suggestions));

      // Send final complete result
      res.write(`data: ${JSON.stringify({ type: 'complete', suggestions })}\n\n`);
      res.end();
      
    } catch (error: any) {
      console.error("Error generating video suggestions:", error);
      
      // For SSE, we need to send error as an event
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: error.message || "Failed to generate video suggestions" 
        });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || 'Failed to generate video suggestions' })}\n\n`);
        res.end();
      }
    }
  });

  // Generate images using both DALL-E 3 and Gemini
  app.post("/api/generate-images", upload.array('referenceImages', 10), async (req, res) => {
    try {
      const { productId, promptDetails, amount, aspectRatio, sessionId, referenceImageUrls: referenceImageUrlsJson, referenceImageMtpKeys: mtpKeysJson } = req.body;
      const referenceImages = req.files as Express.Multer.File[] | undefined;
      const directReferenceUrls: string[] = referenceImageUrlsJson ? JSON.parse(referenceImageUrlsJson) : [];
      const mtpKeys: string[] = mtpKeysJson ? JSON.parse(mtpKeysJson) : [];
      
      if (mtpKeys.length > 0) {
        for (const key of mtpKeys) {
          const publicUrl = `${R2_PUBLIC_URL}/${key}`;
          if (!directReferenceUrls.includes(publicUrl)) {
            directReferenceUrls.push(publicUrl);
          }
        }
        console.log(`[Image Gen] Added ${mtpKeys.length} MTP reference URLs: ${directReferenceUrls.slice(-mtpKeys.length).join(', ')}`);
      }
      
      console.log("[Image Gen] Received sessionId:", sessionId);
      
      // Parse amount (default to 1)
      const imageAmount = amount ? parseInt(amount) : 1;
      
      // Validate required fields
      if (!promptDetails) {
        return res.status(400).json({
          success: false,
          error: "Prompt details are required"
        });
      }

      // Get product details (only if a specific product is selected)
      let product = null;
      if (productId && productId !== 'none') {
        product = await storage.getProduct(productId);
        if (!product) {
          return res.status(404).json({
            success: false,
            error: "Product not found"
          });
        }
      }

      console.log("Generating images for product:", product ? product.name : "No reference product");
      console.log("Prompt details:", promptDetails);
      console.log("Reference images provided:", referenceImages?.length || 0);
      console.log("Image amount:", imageAmount);
      console.log("Aspect ratio:", aspectRatio || "auto");
      
      // Map aspect ratio to OpenAI sizes
      const getOpenAISize = (ratio: string): "1024x1024" | "1536x1024" | "1024x1536" => {
        if (ratio === '16:9' || ratio === '4:3') return '1536x1024'; // Closest to 16:9 and 4:3
        if (ratio === '9:16' || ratio === '3:4') return '1024x1536'; // Closest to 9:16 and 3:4
        // For 1:1 and auto, use square
        return '1024x1024';
      };

      // Build enhanced prompt with product context (if available)
      let enhancedPrompt = product 
        ? `Product: ${product.name}
Offer Type: ${product.offerType}
${promptDetails}

${referenceImages && referenceImages.length > 0
  ? `Using the ${referenceImages.length} reference image(s) provided, create a professional marketing image that combines elements from these images to showcase this product with similar style, lighting, and composition.` 
  : 'Create a professional marketing image for this product.'}`
        : `${promptDetails}

${referenceImages && referenceImages.length > 0
  ? `Using the ${referenceImages.length} reference image(s) provided, create a professional marketing image that combines elements from these images with similar style, lighting, and composition.` 
  : 'Create a professional marketing image.'}`;
      
      // Add aspect ratio to prompt if specified
      if (aspectRatio) {
        enhancedPrompt += `\n\nAspect ratio: ${aspectRatio}`;
      }

      // Check if API keys are available
      const hasGeminiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
      const hasKieKey = process.env.SORA_VERIFIED_KEY && process.env.SORA_VERIFIED_KEY.trim().length > 0;

      // Type for generation results
      type ImageResult = {
        url: string;
        provider: 'gpt' | 'gemini' | 'gemini25' | 'imagen4' | 'nanobanana' | 'nanobanana2';
        revisedPrompt?: string;
      };

      type GenerationResult = {
        images: ImageResult[];
        provider: string;
        error: string | null;
      };

      // Prepare generation tasks
      const generationTasks: Promise<GenerationResult>[] = [];

      // GPT Image 1.5 generation via kie.ai (always run when key available)
      if (hasKieKey) {
        generationTasks.push(
          (async () => {
            const capturedGptTaskIds: string[] = [];
            try {
              const allImages: ImageResult[] = [];
              const kieApiKey = process.env.SORA_VERIFIED_KEY!;

              // Map aspect ratio to GPT Image 1.5 supported ratios (1:1, 2:3, 3:2)
              const getGptImageAspectRatio = (ratio: string): string => {
                if (ratio === '1:1') return '1:1';
                if (ratio === '9:16' || ratio === '3:4' || ratio === '2:3') return '2:3';
                if (ratio === '16:9' || ratio === '4:3' || ratio === '3:2') return '3:2';
                return '1:1';
              };

              const hasRefs = (referenceImages && referenceImages.length > 0) || directReferenceUrls.length > 0;
              const modelName = hasRefs ? 'gpt-image/1.5-image-to-image' : 'gpt-image/1.5-text-to-image';

              let referenceImageUrls: string[] = [];
              if (hasRefs) {
                if (directReferenceUrls.length > 0) {
                  const validUrls = directReferenceUrls.filter(u => u && u.startsWith('https://'));
                  if (validUrls.length > 0) {
                    referenceImageUrls = validUrls;
                    console.log(`[GPT Image 1.5] Using ${validUrls.length} direct R2 URL(s): ${validUrls.join(', ')}`);
                  }
                }

                if (referenceImageUrls.length === 0 && referenceImages && referenceImages.length > 0) {
                  console.log(`[GPT Image 1.5] Saving ${referenceImages.length} reference image(s) to local uploads...`);
                  const uploadsDir = path.join(process.cwd(), 'uploads');
                  if (!fsSync.existsSync(uploadsDir)) {
                    fsSync.mkdirSync(uploadsDir, { recursive: true });
                  }
                  for (let i = 0; i < referenceImages.length; i++) {
                    const img = referenceImages[i];
                    try {
                      const originalSize = img.buffer.length;
                      let saveBuffer: Buffer;
                      let ext: string;

                      if (originalSize > 1024 * 1024) {
                        console.log(`[GPT Image 1.5] Reference image ${i} is ${(originalSize / 1024 / 1024).toFixed(1)}MB, compressing to JPEG...`);
                        saveBuffer = await sharp(img.buffer)
                          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
                          .jpeg({ quality: 85 })
                          .toBuffer();
                        ext = '.jpg';
                        console.log(`[GPT Image 1.5] Compressed to ${(saveBuffer.length / 1024 / 1024).toFixed(1)}MB`);
                      } else {
                        saveBuffer = img.buffer;
                        ext = path.extname(img.originalname) || '.png';
                      }

                      const filename = `gpt15-ref-${Date.now()}-${i}${ext}`;
                      const filepath = path.join(uploadsDir, filename);
                      fsSync.writeFileSync(filepath, saveBuffer);
                      const host = req.get('host') || 'localhost:5000';
                      const protocol = process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'http');
                      const publicUrl = `${protocol}://${host}/uploads/${filename}`;
                      referenceImageUrls.push(publicUrl);
                      console.log(`[GPT Image 1.5] Saved reference image locally: ${publicUrl}`);
                    } catch (uploadError) {
                      console.error(`[GPT Image 1.5] Failed to save reference image:`, uploadError);
                    }
                  }
                }
              }

              const mappedAspectRatio = getGptImageAspectRatio(aspectRatio || '');
              const gptInput: any = {
                prompt: enhancedPrompt,
                aspect_ratio: mappedAspectRatio,
                quality: 'medium'
              };

              if (referenceImageUrls.length > 0) {
                gptInput.input_urls = referenceImageUrls;
              }

              console.log(`[GPT Image 1.5] Model: ${modelName}, Aspect: ${mappedAspectRatio}, Quality: medium`);

              // Create tasks with delays to avoid rate limiting
              const taskIds: string[] = [];
              for (let i = 0; i < imageAmount; i++) {
                if (i > 0) {
                  console.log(`[GPT Image 1.5] Waiting 5 seconds before creating task ${i + 1}...`);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                }

                console.log(`[GPT Image 1.5] Creating task (${i + 1}/${imageAmount})`);

                const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${kieApiKey}`
                  },
                  body: JSON.stringify({
                    model: modelName,
                    input: gptInput
                  })
                });

                if (!createResponse.ok) {
                  const errorText = await createResponse.text();
                  console.error(`[GPT Image 1.5] createTask failed:`, errorText);
                  continue;
                }

                const createResult = await createResponse.json();
                console.log(`[GPT Image 1.5] createTask result:`, JSON.stringify(createResult, null, 2));

                if (createResult.code === 200 && createResult.data?.taskId) {
                  taskIds.push(createResult.data.taskId);
                  capturedGptTaskIds.push(createResult.data.taskId);
                  console.log(`[GPT Image 1.5] Got taskId: ${createResult.data.taskId}`);
                } else {
                  console.error(`[GPT Image 1.5] Invalid response for task ${i + 1}`);
                }
              }

              console.log(`[GPT Image 1.5] Created ${taskIds.length} tasks, now polling in parallel...`);

              // Poll all tasks in parallel
              const pollTask = async (taskId: string): Promise<ImageResult[]> => {
                const maxAttempts = 60;
                let attempts = 0;

                while (attempts < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  attempts++;

                  console.log(`[GPT Image 1.5] Poll attempt ${attempts}/${maxAttempts} for task ${taskId}`);

                  try {
                    const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                      headers: {
                        'Authorization': `Bearer ${kieApiKey}`
                      }
                    });

                    if (!statusResponse.ok) {
                      console.error(`[GPT Image 1.5] Status check failed for ${taskId}`);
                      continue;
                    }

                    const statusResult = await statusResponse.json();

                    if (statusResult.code === 200 && statusResult.data) {
                      const state = statusResult.data.state;

                      if (state === 'success') {
                        try {
                          const resultData = JSON.parse(statusResult.data.resultJson || '{}');
                          const imageUrls = resultData.resultUrls || [];
                          console.log(`[GPT Image 1.5] Task ${taskId} completed with ${imageUrls.length} image(s)`);
                          return imageUrls.map((url: string) => ({
                            url: url,
                            provider: 'gpt' as const
                          }));
                        } catch (parseError) {
                          console.error(`[GPT Image 1.5] Failed to parse resultJson:`, parseError);
                          return [];
                        }
                      } else if (state === 'fail') {
                        console.error(`[GPT Image 1.5] Task ${taskId} failed:`, statusResult.data.failMsg);
                        return [];
                      }
                    }
                  } catch (pollError) {
                    console.error(`[GPT Image 1.5] Poll error for ${taskId}:`, pollError);
                  }
                }

                console.error(`[GPT Image 1.5] Task ${taskId} timed out`);
                return [];
              };

              const taskResults = await Promise.all(taskIds.map(taskId => pollTask(taskId)));
              for (const images of taskResults) {
                allImages.push(...images);
              }

              if (allImages.length === 0) {
                return { images: [], provider: 'gpt', error: 'No images generated', taskIds };
              }

              return { images: allImages, provider: 'gpt', error: null, taskIds };
            } catch (error: any) {
              console.error("GPT Image 1.5 generation error:", error);
              return { images: [], provider: 'gpt', error: error?.message || 'Unknown error', taskIds: capturedGptTaskIds };
            }
          })()
        );
      } else {
        // No kie.ai key - push a placeholder result
        generationTasks.push(
          Promise.resolve({ images: [], provider: 'gpt', error: 'kie.ai API key not configured for GPT Image 1.5', taskIds: [] })
        );
      }

      // Gemini 2.0 Flash was retired on October 31, 2025 - removed from system

      // Add Gemini 2.5 Flash Image generation if API key is available
      if (hasGeminiKey) {
        generationTasks.push(
          (async () => {
            try {
              const allImages: ImageResult[] = [];
              
              // Build parts array for Gemini (text + optional images)
              // Per Gemini docs: for image generation, pass parts directly as contents array
              const parts: any[] = [{ text: enhancedPrompt }];
              
              if (referenceImages && referenceImages.length > 0) {
                // Add all reference images to the request
                console.log(`Adding ${referenceImages.length} reference image(s) to Gemini 2.5 request`);
                referenceImages.forEach((img) => {
                  const imageBuffer = img.buffer;
                  const base64Image = imageBuffer.toString('base64');
                  
                  parts.push({
                    inlineData: {
                      mimeType: img.mimetype,
                      data: base64Image
                    }
                  });
                });
              }
              
              // Generate images based on imageAmount
              const gemini25Promises = Array.from({ length: imageAmount }, async (_, i) => {
                console.log(`Calling Gemini 2.5 (${i + 1}/${imageAmount})`);
                
                // Build config object with aspect ratio if specified
                const geminiConfig: any = {
                  responseModalities: [Modality.TEXT, Modality.IMAGE],
                  safetySettings: [
                    {
                      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                      threshold: HarmBlockThreshold.BLOCK_NONE
                    },
                    {
                      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                      threshold: HarmBlockThreshold.BLOCK_NONE
                    },
                    {
                      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                      threshold: HarmBlockThreshold.BLOCK_NONE
                    },
                    {
                      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                      threshold: HarmBlockThreshold.BLOCK_NONE
                    }
                  ]
                };
                
                // Add aspect ratio to imageConfig if specified (must be nested in imageConfig object)
                if (aspectRatio) {
                  geminiConfig.imageConfig = {
                    aspectRatio: aspectRatio
                  };
                }
                
                return await gemini.models.generateContent({
                  model: "gemini-2.5-flash-image",
                  contents: parts,  // Pass parts array directly, not wrapped in role object
                  config: geminiConfig
                });
              });
              
              const responses = await Promise.all(gemini25Promises);
              console.log(`Gemini 2.5 generated ${responses.length} responses`);
              
              // Collect all images from all responses
              for (const response of responses) {
                const candidates = response.candidates;
                if (candidates && candidates.length > 0) {
                  const content = candidates[0].content;
                  if (content && content.parts) {
                    for (const part of content.parts) {
                      if (part.inlineData && part.inlineData.data) {
                        // Convert base64 to data URL
                        const mimeType = part.inlineData.mimeType || 'image/png';
                        const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                        allImages.push({
                          url: dataUrl,
                          provider: 'gemini25' as const
                        });
                      }
                    }
                  }
                }
              }

              if (allImages.length === 0) {
                return { 
                  images: [], 
                  provider: 'gemini25', 
                  error: 'No valid images in response' 
                };
              }

              return { 
                images: allImages, 
                provider: 'gemini25', 
                error: null 
              };
            } catch (error: any) {
              console.error("Gemini 2.5 generation error:", error);
              return { 
                images: [], 
                provider: 'gemini25', 
                error: error?.message || 'Unknown error' 
              };
            }
          })()
        );
      }

      // Add Imagen 4 generation if API key is available
      // IMPORTANT: Imagen 4 only supports text-to-image, NOT image-to-image
      if (hasGeminiKey && (!referenceImages || referenceImages.length === 0)) {
        generationTasks.push(
          (async () => {
            try {
              const allImages: ImageResult[] = [];
              
              console.log(`Calling Imagen 4 text-to-image (${imageAmount} images)`);
              
              // Use the generateImages API (not generateContent)
              const response = await gemini.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: enhancedPrompt,
                config: {
                  numberOfImages: imageAmount,
                  aspectRatio: aspectRatio === 'auto' ? '1:1' : aspectRatio as any,
                  // Note: imageSize '2K' would be for Ultra quality, but keeping default '1K' for reliability
                }
              });
              
              console.log(`Imagen 4 generated ${response.generatedImages?.length || 0} images`);
              
              // Process generated images
              for (const generatedImage of response.generatedImages || []) {
                if (generatedImage.image?.imageBytes) {
                  const base64Image = generatedImage.image.imageBytes;
                  const dataUrl = `data:image/png;base64,${base64Image}`;
                  allImages.push({
                    url: dataUrl,
                    provider: 'imagen4' as const
                  });
                }
              }

              if (allImages.length === 0) {
                return { 
                  images: [], 
                  provider: 'imagen4', 
                  error: 'No valid images in response' 
                };
              }

              return { 
                images: allImages, 
                provider: 'imagen4', 
                error: null 
              };
            } catch (error: any) {
              console.error("Imagen 4 generation error:", error);
              return { 
                images: [], 
                provider: 'imagen4', 
                error: error?.message || 'Unknown error' 
              };
            }
          })()
        );
      }

      // Add Nano Banana Pro generation via kie.ai if API key is available
      if (hasKieKey) {
        generationTasks.push(
          (async () => {
            const capturedNanoTaskIds: string[] = [];
            try {
              const allImages: ImageResult[] = [];
              const kieApiKey = process.env.SORA_VERIFIED_KEY!;
              
              // Map aspect ratio to Nano Banana Pro format
              const getNanoBananaAspectRatio = (ratio: string): string => {
                if (ratio === '16:9') return '16:9';
                if (ratio === '9:16') return '9:16';
                if (ratio === '4:3') return '4:3';
                if (ratio === '3:4') return '3:4';
                if (ratio === '1:1') return '1:1';
                return '1:1'; // Default
              };
              
              // Save reference images to local /uploads/ directory (same approach as video generation)
              // This ensures Kie.ai can access them via direct static file serving
              let referenceImageUrls: string[] = [];
              
              if (directReferenceUrls.length > 0) {
                const validUrls = directReferenceUrls.filter(u => u && u.startsWith('https://'));
                if (validUrls.length > 0) {
                  referenceImageUrls = [...validUrls];
                  console.log(`[Nano Banana Pro] Using ${validUrls.length} direct R2 URL(s): ${validUrls.join(', ')}`);
                }
              }
              
              if (referenceImages && referenceImages.length > 0) {
                console.log(`[Nano Banana Pro] Saving ${referenceImages.length} reference image(s) to local uploads...`);
                const uploadsDir = path.join(process.cwd(), 'uploads');
                if (!fsSync.existsSync(uploadsDir)) {
                  fsSync.mkdirSync(uploadsDir, { recursive: true });
                }
                
                for (let i = 0; i < referenceImages.length; i++) {
                  const img = referenceImages[i];
                  try {
                    const ext = path.extname(img.originalname) || '.png';
                    const filename = `nano-ref-${Date.now()}-${i}${ext}`;
                    const filepath = path.join(uploadsDir, filename);
                    fsSync.writeFileSync(filepath, img.buffer);
                    
                    const host = req.get('host') || 'localhost:5000';
                    const protocol = process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'http');
                    const publicUrl = `${protocol}://${host}/uploads/${filename}`;
                    referenceImageUrls.push(publicUrl);
                    console.log(`[Nano Banana Pro] Saved reference image: ${publicUrl}`);
                  } catch (uploadError) {
                    console.error(`[Nano Banana Pro] Failed to save reference image:`, uploadError);
                  }
                }
              }
              
              // Generate images based on imageAmount - CREATE ALL TASKS FIRST (with 5s delay between each)
              const taskIds: string[] = [];
              
              // Build input for Nano Banana Pro (shared across all tasks)
              const mappedAspectRatio = getNanoBananaAspectRatio(aspectRatio || '');
              const nanoInput: any = {
                prompt: enhancedPrompt,
                aspect_ratio: mappedAspectRatio,
                resolution: '2K',
                output_format: 'png'
              };
              
              // Add reference images if available
              if (referenceImageUrls.length > 0) {
                nanoInput.image_input = referenceImageUrls;
                console.log(`[Nano Banana Pro] Using ${referenceImageUrls.length} reference image(s)`);
              }
              
              // DEBUG: Log full payload details
              console.log(`[Nano Banana Pro] === PAYLOAD DEBUG ===`);
              console.log(`[Nano Banana Pro] Original aspect ratio: "${aspectRatio}"`);
              console.log(`[Nano Banana Pro] Mapped aspect ratio: "${mappedAspectRatio}"`);
              console.log(`[Nano Banana Pro] Prompt length: ${enhancedPrompt.length} chars (max 5000)`);
              console.log(`[Nano Banana Pro] Prompt preview: "${enhancedPrompt.substring(0, 200)}..."`);
              console.log(`[Nano Banana Pro] Full input: ${JSON.stringify(nanoInput, null, 2)}`);
              
              // Step 1: Create all tasks with 5-second delays to avoid rate limiting
              for (let i = 0; i < imageAmount; i++) {
                // Add 5-second delay before each request (except the first one)
                if (i > 0) {
                  console.log(`[Nano Banana Pro] Waiting 5 seconds before creating task ${i + 1}...`);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                }
                
                console.log(`[Nano Banana Pro] Creating task (${i + 1}/${imageAmount})`);
                
                const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${kieApiKey}`
                  },
                  body: JSON.stringify({
                    model: 'nano-banana-pro',
                    input: nanoInput
                  })
                });
                
                if (!createResponse.ok) {
                  const errorText = await createResponse.text();
                  console.error(`[Nano Banana Pro] createTask failed:`, errorText);
                  continue; // Skip this task but continue with others
                }
                
                const createResult = await createResponse.json();
                console.log(`[Nano Banana Pro] createTask result:`, JSON.stringify(createResult, null, 2));
                
                if (createResult.code === 200 && createResult.data?.taskId) {
                  taskIds.push(createResult.data.taskId);
                  capturedNanoTaskIds.push(createResult.data.taskId);
                  console.log(`[Nano Banana Pro] Got taskId: ${createResult.data.taskId}`);
                } else {
                  console.error(`[Nano Banana Pro] Invalid response for task ${i + 1}`);
                }
              }
              
              console.log(`[Nano Banana Pro] Created ${taskIds.length} tasks, now polling in parallel...`);
              
              // Step 2: Poll all tasks in parallel
              const pollTask = async (taskId: string): Promise<ImageResult[]> => {
                const maxAttempts = 60; // 5 minutes max (5s intervals)
                let attempts = 0;
                
                while (attempts < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                  attempts++;
                  
                  console.log(`[Nano Banana Pro] Poll attempt ${attempts}/${maxAttempts} for task ${taskId}`);
                  
                  try {
                    const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                      headers: {
                        'Authorization': `Bearer ${kieApiKey}`
                      }
                    });
                    
                    if (!statusResponse.ok) {
                      console.error(`[Nano Banana Pro] Status check failed for ${taskId}`);
                      continue;
                    }
                    
                    const statusResult = await statusResponse.json();
                    
                    if (statusResult.code === 200 && statusResult.data) {
                      const state = statusResult.data.state;
                      
                      if (state === 'success') {
                        try {
                          const resultData = JSON.parse(statusResult.data.resultJson || '{}');
                          const imageUrls = resultData.resultUrls || [];
                          console.log(`[Nano Banana Pro] Task ${taskId} completed with ${imageUrls.length} image(s)`);
                          return imageUrls.map((url: string) => ({
                            url: url,
                            provider: 'nanobanana' as const
                          }));
                        } catch (parseError) {
                          console.error(`[Nano Banana Pro] Failed to parse resultJson:`, parseError);
                          return [];
                        }
                      } else if (state === 'fail') {
                        console.error(`[Nano Banana Pro] Task ${taskId} failed:`, statusResult.data.failMsg);
                        return [];
                      }
                      // Still processing, continue polling
                    }
                  } catch (pollError) {
                    console.error(`[Nano Banana Pro] Poll error for ${taskId}:`, pollError);
                  }
                }
                
                console.error(`[Nano Banana Pro] Task ${taskId} timed out`);
                return [];
              };
              
              // Poll all tasks in parallel and collect results
              const taskResults = await Promise.all(taskIds.map(taskId => pollTask(taskId)));
              
              // Flatten all results into allImages
              for (const images of taskResults) {
                allImages.push(...images);
              }
              
              if (allImages.length === 0) {
                return { 
                  images: [], 
                  provider: 'nanobanana', 
                  error: 'No valid images in response',
                  taskIds
                };
              }
              
              return { 
                images: allImages, 
                provider: 'nanobanana', 
                error: null,
                taskIds
              };
            } catch (error: any) {
              console.error("Nano Banana Pro generation error:", error);
              return { 
                images: [], 
                provider: 'nanobanana', 
                error: error?.message || 'Unknown error',
                taskIds: capturedNanoTaskIds
              };
            }
          })()
        );
      }

      // Add Nano Banana 2 generation via kie.ai if API key is available
      if (hasKieKey) {
        generationTasks.push(
          (async () => {
            const capturedNano2TaskIds: string[] = [];
            try {
              const allImages: ImageResult[] = [];
              const kieApiKey = process.env.SORA_VERIFIED_KEY!;
              
              // Map aspect ratio to Nano Banana 2 format
              const getNanoBanana2AspectRatio = (ratio: string): string => {
                if (ratio === '16:9') return '16:9';
                if (ratio === '9:16') return '9:16';
                if (ratio === '4:3') return '4:3';
                if (ratio === '3:4') return '3:4';
                if (ratio === '1:1') return '1:1';
                return '1:1';
              };
              
              let referenceImageUrls2: string[] = [];
              
              if (directReferenceUrls.length > 0) {
                const validUrls = directReferenceUrls.filter((u: string) => u && u.startsWith('https://'));
                if (validUrls.length > 0) {
                  referenceImageUrls2 = [...validUrls];
                  console.log(`[Nano Banana 2] Using ${validUrls.length} direct R2 URL(s)`);
                }
              }
              
              if (referenceImages && referenceImages.length > 0) {
                console.log(`[Nano Banana 2] Saving ${referenceImages.length} reference image(s) to local uploads...`);
                const uploadsDir = path.join(process.cwd(), 'uploads');
                if (!fsSync.existsSync(uploadsDir)) {
                  fsSync.mkdirSync(uploadsDir, { recursive: true });
                }
                for (let i = 0; i < referenceImages.length; i++) {
                  const img = referenceImages[i];
                  try {
                    const ext = path.extname(img.originalname) || '.png';
                    const filename = `nano2-ref-${Date.now()}-${i}${ext}`;
                    const filepath = path.join(uploadsDir, filename);
                    fsSync.writeFileSync(filepath, img.buffer);
                    const host = req.get('host') || 'localhost:5000';
                    const protocol = process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'http');
                    const publicUrl = `${protocol}://${host}/uploads/${filename}`;
                    referenceImageUrls2.push(publicUrl);
                    console.log(`[Nano Banana 2] Saved reference image: ${publicUrl}`);
                  } catch (uploadError) {
                    console.error(`[Nano Banana 2] Failed to save reference image:`, uploadError);
                  }
                }
              }
              
              const taskIds: string[] = [];
              const mappedAspectRatio2 = getNanoBanana2AspectRatio(aspectRatio || '');
              const nano2Input: any = {
                prompt: enhancedPrompt,
                aspect_ratio: mappedAspectRatio2,
                resolution: '2K',
                output_format: 'png'
              };
              if (referenceImageUrls2.length > 0) {
                nano2Input.image_input = referenceImageUrls2;
                console.log(`[Nano Banana 2] Using ${referenceImageUrls2.length} reference image(s)`);
              }
              
              console.log(`[Nano Banana 2] Aspect ratio: "${mappedAspectRatio2}", prompt length: ${enhancedPrompt.length} chars`);
              
              for (let i = 0; i < imageAmount; i++) {
                if (i > 0) {
                  console.log(`[Nano Banana 2] Waiting 5 seconds before creating task ${i + 1}...`);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                }
                console.log(`[Nano Banana 2] Creating task (${i + 1}/${imageAmount})`);
                const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${kieApiKey}`
                  },
                  body: JSON.stringify({ model: 'nano-banana-2', input: nano2Input })
                });
                if (!createResponse.ok) {
                  const errorText = await createResponse.text();
                  console.error(`[Nano Banana 2] createTask failed:`, errorText);
                  continue;
                }
                const createResult = await createResponse.json();
                console.log(`[Nano Banana 2] createTask result:`, JSON.stringify(createResult, null, 2));
                if (createResult.code === 200 && createResult.data?.taskId) {
                  taskIds.push(createResult.data.taskId);
                  capturedNano2TaskIds.push(createResult.data.taskId);
                  console.log(`[Nano Banana 2] Got taskId: ${createResult.data.taskId}`);
                } else {
                  console.error(`[Nano Banana 2] Invalid response for task ${i + 1}`);
                }
              }
              
              console.log(`[Nano Banana 2] Created ${taskIds.length} tasks, now polling in parallel...`);
              
              const pollTask2 = async (taskId: string): Promise<ImageResult[]> => {
                const maxAttempts = 60;
                let attempts = 0;
                while (attempts < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  attempts++;
                  console.log(`[Nano Banana 2] Poll attempt ${attempts}/${maxAttempts} for task ${taskId}`);
                  try {
                    const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                      headers: { 'Authorization': `Bearer ${kieApiKey}` }
                    });
                    if (!statusResponse.ok) {
                      console.error(`[Nano Banana 2] Status check failed for ${taskId}`);
                      continue;
                    }
                    const statusResult = await statusResponse.json();
                    if (statusResult.code === 200 && statusResult.data) {
                      const state = statusResult.data.state;
                      if (state === 'success') {
                        try {
                          const resultData = JSON.parse(statusResult.data.resultJson || '{}');
                          const imageUrls = resultData.resultUrls || [];
                          console.log(`[Nano Banana 2] Task ${taskId} completed with ${imageUrls.length} image(s)`);
                          return imageUrls.map((url: string) => ({
                            url: url,
                            provider: 'nanobanana2' as const
                          }));
                        } catch (parseError) {
                          console.error(`[Nano Banana 2] Failed to parse resultJson:`, parseError);
                          return [];
                        }
                      } else if (state === 'fail') {
                        console.error(`[Nano Banana 2] Task ${taskId} failed:`, statusResult.data.failMsg);
                        return [];
                      }
                    }
                  } catch (pollError) {
                    console.error(`[Nano Banana 2] Poll error for ${taskId}:`, pollError);
                  }
                }
                console.error(`[Nano Banana 2] Task ${taskId} timed out`);
                return [];
              };
              
              const taskResults2 = await Promise.all(taskIds.map(taskId => pollTask2(taskId)));
              for (const images of taskResults2) {
                allImages.push(...images);
              }
              
              if (allImages.length === 0) {
                return { images: [], provider: 'nanobanana2', error: 'No valid images in response', taskIds };
              }
              return { images: allImages, provider: 'nanobanana2', error: null, taskIds };
            } catch (error: any) {
              console.error("Nano Banana 2 generation error:", error);
              return { images: [], provider: 'nanobanana2', error: error?.message || 'Unknown error', taskIds: capturedNano2TaskIds };
            }
          })()
        );
      }

      // Run all generation tasks
      const results = await Promise.all(generationTasks);
      
      // Map results correctly based on which tasks were actually added
      const hasReferenceImages = referenceImages && referenceImages.length > 0;
      let resultIndex = 0;
      
      // GPT Image 1.5 via kie.ai (always added to generationTasks, even as placeholder)
      const dalleResult = results[resultIndex++];
      
      // Gemini 2.0 was retired October 31, 2025 - no longer available
      const geminiResult = { images: [], provider: 'gemini', error: 'Gemini 2.0 Flash was retired on October 31, 2025' };
        
      // Gemini 2.5 runs when API key is available (supports both text-to-image and image-to-image)
      const gemini25Result = hasGeminiKey 
        ? results[resultIndex++] 
        : { images: [], provider: 'gemini25', error: 'Gemini API key not configured' };
      
      // ONLY Imagen 4 is text-to-image only (skips when reference images provided)
      const imagen4Result = (hasGeminiKey && !hasReferenceImages) 
        ? results[resultIndex++] 
        : { images: [], provider: 'imagen4', error: hasReferenceImages ? 'Imagen 4 only supports text-to-image generation' : 'Gemini API key not configured' };
      
      // Nano Banana Pro runs when kie.ai key is available (supports both text-to-image and image-to-image)
      const nanoBananaResult = hasKieKey 
        ? results[resultIndex++] 
        : { images: [], provider: 'nanobanana', error: 'kie.ai API key not configured' };

      // Nano Banana 2 runs when kie.ai key is available (supports both text-to-image and image-to-image)
      const nanoBanana2Result = hasKieKey 
        ? results[resultIndex++] 
        : { images: [], provider: 'nanobanana2', error: 'kie.ai API key not configured' };

      console.log("OpenAI images count:", dalleResult.images.length);
      console.log("Gemini 2.0 (RETIRED October 31, 2025)");
      console.log("Gemini 2.5 images count:", gemini25Result.images.length);
      console.log("Imagen 4 Ultra images count:", imagen4Result.images.length);
      console.log("Nano Banana Pro images count:", nanoBananaResult.images.length);
      console.log("Nano Banana 2 images count:", nanoBanana2Result.images.length);

      // Auto-save all generated images to database with sessionId (for background recovery)
      if (sessionId) {
        console.log("[Image Gen] Auto-saving images with sessionId:", sessionId);
        
        // Upload reference image to storage if provided
        let referenceImageStoragePath: string | null = null;
        if (referenceImages && referenceImages.length > 0) {
          try {
            const refImage = referenceImages[0];
            const referenceImagePath = await uploadToStorage(
              refImage.buffer,
              refImage.originalname,
              refImage.mimetype
            );
            referenceImageStoragePath = referenceImagePath;
            console.log(`[Image Gen] Uploaded reference image to: ${referenceImageStoragePath}`);
          } catch (error) {
            console.error("[Image Gen] Failed to upload reference image:", error);
          }
        }
        
        const savePromises: Promise<any>[] = [];
        
        // Save all GPT images
        dalleResult.images.forEach(img => {
          savePromises.push(
            storage.createSavedImage({
              url: img.url,
              provider: 'gpt',
              prompt: promptDetails,
              revisedPrompt: img.revisedPrompt || null,
              productId: productId === 'none' ? null : productId,
              referenceImageUrl: referenceImageStoragePath,
              sessionId: sessionId,
              status: 'auto-generated',
            })
          );
        });
        
        // Save all Gemini 2.5 images
        gemini25Result.images.forEach(img => {
          savePromises.push(
            storage.createSavedImage({
              url: img.url,
              provider: 'gemini25',
              prompt: promptDetails,
              revisedPrompt: img.revisedPrompt || null,
              productId: productId === 'none' ? null : productId,
              referenceImageUrl: referenceImageStoragePath,
              sessionId: sessionId,
              status: 'auto-generated',
            })
          );
        });
        
        // Save all Imagen 4 images
        imagen4Result.images.forEach(img => {
          savePromises.push(
            storage.createSavedImage({
              url: img.url,
              provider: 'imagen4',
              prompt: promptDetails,
              revisedPrompt: img.revisedPrompt || null,
              productId: productId === 'none' ? null : productId,
              referenceImageUrl: referenceImageStoragePath,
              sessionId: sessionId,
              status: 'auto-generated',
            })
          );
        });
        
        // Save all Nano Banana Pro images
        nanoBananaResult.images.forEach(img => {
          savePromises.push(
            storage.createSavedImage({
              url: img.url,
              provider: 'nanobanana',
              prompt: promptDetails,
              revisedPrompt: img.revisedPrompt || null,
              productId: productId === 'none' ? null : productId,
              referenceImageUrl: referenceImageStoragePath,
              sessionId: sessionId,
              status: 'auto-generated',
            })
          );
        });

        // Save all Nano Banana 2 images
        nanoBanana2Result.images.forEach(img => {
          savePromises.push(
            storage.createSavedImage({
              url: img.url,
              provider: 'nanobanana2',
              prompt: promptDetails,
              revisedPrompt: img.revisedPrompt || null,
              productId: productId === 'none' ? null : productId,
              referenceImageUrl: referenceImageStoragePath,
              sessionId: sessionId,
              status: 'auto-generated',
            })
          );
        });
        
        await Promise.all(savePromises);
        console.log(`[Image Gen] Auto-saved ${savePromises.length} images to database`);
      }

      // Return all sets of images
      const kieTaskIds = [
        ...(dalleResult.taskIds || []).map((id: string) => ({ taskId: id, provider: 'gpt' })),
        ...(nanoBananaResult.taskIds || []).map((id: string) => ({ taskId: id, provider: 'nanobanana' })),
        ...(nanoBanana2Result.taskIds || []).map((id: string) => ({ taskId: id, provider: 'nanobanana2' })),
      ];
      
      res.json({
        success: true,
        gptImages: dalleResult.images,
        geminiImages: geminiResult.images,
        gemini25Images: gemini25Result.images,
        imagen4Images: imagen4Result.images,
        nanoBananaImages: nanoBananaResult.images,
        nanoBanana2Images: nanoBanana2Result.images,
        kieTaskIds,
        errors: {
          gpt: dalleResult.error,
          gemini: geminiResult.error,
          gemini25: gemini25Result.error,
          imagen4: imagen4Result.error,
          nanobanana: nanoBananaResult.error,
          nanobanana2: nanoBanana2Result.error
        }
      });
    } catch (error: any) {
      console.error("Image generation error:", error);
      res.status(500).json({ 
        success: false, 
        error: "Failed to generate images" 
      });
    }
  });

  // Save image to library
  app.post("/api/saved-images", async (req, res) => {
    try {
      const savedImage = await storage.createSavedImage(req.body);
      res.json({ success: true, savedImage });
    } catch (error: any) {
      console.error("Error saving image:", error);
      res.status(500).json({ success: false, error: "Failed to save image" });
    }
  });

  // Get all saved images (with optional pagination)
  app.get("/api/saved-images", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 30;
      const productId = req.query.productId as string | undefined;
      const includeUnsaved = req.query.includeUnsaved === 'true';
      
      console.log(`[Image Library] Query params: page=${page}, limit=${limit}, productId=${productId}, includeUnsaved=${includeUnsaved}`);
      
      // If pagination parameters are provided, use paginated query
      if (req.query.page || req.query.limit) {
        const result = await storage.getSavedImagesPaginated({ 
          page, 
          limit, 
          productId,
          includeUnsaved
        });
        console.log(`[Image Library] Found ${result.total} total images, returning ${result.items.length} items for page ${result.currentPage}/${result.totalPages}`);
        
        // Check for problematic data URLs and log them
        result.items.forEach((item, index) => {
          const urlLength = item.url?.length || 0;
          if (urlLength > 100000) {
            console.warn(`[Image Library] Image ${index} (id: ${item.id}) has very large URL: ${urlLength} characters`);
          }
        });
        
        // Ensure result has all required fields
        const response = { 
          success: true, 
          items: result.items || [],
          total: result.total || 0,
          totalPages: result.totalPages || 1,
          currentPage: result.currentPage || 1
        };
        
        console.log('[Image Library] Sending response...');
        try {
          res.json(response);
          console.log('[Image Library] Response sent successfully');
        } catch (sendError) {
          console.error('[Image Library] Error sending response:', sendError);
          throw sendError;
        }
      } else {
        // Fallback to original behavior for backward compatibility
        const savedImages = await storage.getSavedImages();
        res.json({ success: true, savedImages });
      }
    } catch (error: any) {
      console.error("[Image Library] Error fetching saved images:", error);
      console.error("[Image Library] Error stack:", error.stack);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to fetch saved images",
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Get saved images by product
  app.get("/api/saved-images/product/:productId", async (req, res) => {
    try {
      const { productId } = req.params;
      const includeUnsaved = req.query.includeUnsaved === 'true';
      const savedImages = await storage.getSavedImagesByProduct(productId, includeUnsaved);
      res.json({ success: true, savedImages });
    } catch (error: any) {
      console.error("Error fetching saved images by product:", error);
      res.status(500).json({ success: false, error: "Failed to fetch saved images" });
    }
  });

  // Get saved images by session (for background generation recovery)
  app.get("/api/saved-images/session/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const savedImages = await storage.getSavedImagesBySession(sessionId);
      res.json({ success: true, savedImages });
    } catch (error: any) {
      console.error("Error fetching saved images by session:", error);
      res.status(500).json({ success: false, error: "Failed to fetch saved images" });
    }
  });

  // Get saved images by IDs (for "Use for Video" feature)
  app.post("/api/saved-images/by-ids", async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ success: false, error: "IDs must be an array" });
      }
      
      const images = await Promise.all(
        ids.map(id => storage.getSavedImage(String(id)))
      );
      
      // Filter out nulls in case any IDs don't exist
      const validImages = images.filter(img => img !== null);
      
      res.json({ success: true, images: validImages });
    } catch (error: any) {
      console.error("Error fetching saved images by IDs:", error);
      res.status(500).json({ success: false, error: "Failed to fetch saved images by IDs" });
    }
  });

  // Get individual image data (for large base64 images)
  app.get("/api/saved-images/:id/image", async (req, res) => {
    try {
      const { id } = req.params;
      const savedImage = await storage.getSavedImage(id);
      
      if (!savedImage) {
        return res.status(404).json({ success: false, error: "Image not found" });
      }
      
      // If URL is a base64 data URL, convert to actual image
      if (savedImage.url.startsWith('data:image')) {
        const matches = savedImage.url.match(/^data:image\/([^;]+);base64,(.+)$/);
        if (matches) {
          const contentType = `image/${matches[1]}`;
          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, 'base64');
          
          res.set('Content-Type', contentType);
          res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
          return res.send(buffer);
        }
      }
      
      // If URL is a storage path, redirect to it
      if (savedImage.url.startsWith('/storage/')) {
        return res.redirect(savedImage.url);
      }
      
      // Otherwise return the URL as JSON
      res.json({ success: true, url: savedImage.url });
    } catch (error: any) {
      console.error("Error fetching image:", error);
      res.status(500).json({ success: false, error: "Failed to fetch image" });
    }
  });

  // Get reference image data (for large base64 reference images)
  app.get("/api/saved-images/:id/reference-image", async (req, res) => {
    try {
      const { id } = req.params;
      const savedImage = await storage.getSavedImage(id);
      
      if (!savedImage || !savedImage.referenceImageUrl) {
        return res.status(404).json({ success: false, error: "Reference image not found" });
      }
      
      // If URL is a base64 data URL, convert to actual image
      if (savedImage.referenceImageUrl.startsWith('data:image')) {
        const matches = savedImage.referenceImageUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
        if (matches) {
          const contentType = `image/${matches[1]}`;
          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, 'base64');
          
          res.set('Content-Type', contentType);
          res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
          return res.send(buffer);
        }
      }
      
      // If URL is a storage path, redirect to it
      if (savedImage.referenceImageUrl.startsWith('/storage/')) {
        return res.redirect(savedImage.referenceImageUrl);
      }
      
      // Otherwise return the URL as JSON
      res.json({ success: true, url: savedImage.referenceImageUrl });
    } catch (error: any) {
      console.error("Error fetching reference image:", error);
      res.status(500).json({ success: false, error: "Failed to fetch reference image" });
    }
  });

  // Update saved image (e.g., change product association)
  app.patch("/api/saved-images/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const savedImage = await storage.updateSavedImage(id, req.body);
      if (!savedImage) {
        return res.status(404).json({ success: false, error: "Image not found" });
      }
      res.json({ success: true, savedImage });
    } catch (error: any) {
      console.error("Error updating saved image:", error);
      res.status(500).json({ success: false, error: "Failed to update saved image" });
    }
  });

  // Delete saved image
  app.delete("/api/saved-images/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteSavedImage(id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: "Image not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting saved image:", error);
      res.status(500).json({ success: false, error: "Failed to delete saved image" });
    }
  });

  // Recover images from kie.ai tasks that were generated but not fetched (e.g., server restart mid-generation)
  app.post("/api/images/recover-tasks", async (req, res) => {
    try {
      const { taskIds } = req.body;
      if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
        return res.status(400).json({ success: false, error: "taskIds array required" });
      }

      const kieApiKey = process.env.SORA_VERIFIED_KEY;
      if (!kieApiKey) {
        return res.status(500).json({ success: false, error: "kie.ai API key not configured" });
      }

      console.log(`[Recovery] Recovering ${taskIds.length} task(s) in parallel`);
      const startTime = Date.now();

      const results = await Promise.all(taskIds.map(async ({ taskId, provider }: { taskId: string; provider: string }) => {
        try {
          const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            headers: { 'Authorization': `Bearer ${kieApiKey}` }
          });

          if (!statusResponse.ok) {
            console.error(`[Recovery] Status check failed for ${taskId}`);
            return { taskId, images: [], failed: true };
          }

          const statusResult = await statusResponse.json();

          if (statusResult.code !== 200 || !statusResult.data) {
            return { taskId, images: [], failed: true };
          }

          const state = statusResult.data.state;

          if (state === 'success') {
            try {
              const resultData = JSON.parse(statusResult.data.resultJson || '{}');
              const imageUrls = resultData.resultUrls || [];
              console.log(`[Recovery] Task ${taskId} (${provider}) -> ${imageUrls.length} image(s) [instant]`);
              return { taskId, images: imageUrls.map((url: string) => ({ url, provider: provider || 'unknown' })), failed: false };
            } catch (parseError) {
              return { taskId, images: [], failed: true };
            }
          } else if (state === 'fail') {
            console.error(`[Recovery] Task ${taskId} failed: ${statusResult.data.failMsg}`);
            return { taskId, images: [], failed: true };
          } else {
            console.log(`[Recovery] Task ${taskId} still ${state}, polling...`);
            for (let attempt = 0; attempt < 24; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 3000));
              try {
                const pollResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                  headers: { 'Authorization': `Bearer ${kieApiKey}` }
                });
                const pollResult = await pollResponse.json();
                if (pollResult.code === 200 && pollResult.data?.state === 'success') {
                  const resultData = JSON.parse(pollResult.data.resultJson || '{}');
                  const imageUrls = resultData.resultUrls || [];
                  console.log(`[Recovery] Task ${taskId} completed after ${attempt + 1} polls`);
                  return { taskId, images: imageUrls.map((url: string) => ({ url, provider: provider || 'unknown' })), failed: false };
                } else if (pollResult.data?.state === 'fail') {
                  return { taskId, images: [], failed: true };
                }
              } catch (pollError) {
                console.error(`[Recovery] Poll error for ${taskId}:`, pollError);
              }
            }
            return { taskId, images: [], failed: true };
          }
        } catch (error) {
          console.error(`[Recovery] Error recovering task ${taskId}:`, error);
          return { taskId, images: [], failed: true };
        }
      }));

      const recoveredImages = results.flatMap(r => r.images);
      const failedTasks = results.filter(r => r.failed).map(r => r.taskId);

      console.log(`[Recovery] Done in ${Date.now() - startTime}ms: ${recoveredImages.length} images recovered, ${failedTasks.length} failed`);

      res.json({
        success: true,
        images: recoveredImages,
        failedTasks,
      });
    } catch (error: any) {
      console.error("[Recovery] Error:", error);
      res.status(500).json({ success: false, error: error.message || "Recovery failed" });
    }
  });

  // Image proxy endpoint - fetch external images to bypass CORS
  app.post("/api/images/proxy", async (req, res) => {
    try {
      const { url } = req.body;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({
          success: false,
          error: "Missing required field: url"
        });
      }

      // Check if it's already a data URL - just return it
      if (url.startsWith('data:')) {
        return res.json({ success: true, dataUrl: url });
      }

      // Fetch the image from the external URL
      console.log("[Image Proxy] Fetching:", url.substring(0, 100) + "...");
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const dataUrl = `data:${contentType};base64,${base64}`;

      console.log("[Image Proxy] Successfully fetched and converted to data URL");
      res.json({ success: true, dataUrl });
    } catch (error: any) {
      console.error("[Image Proxy] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to proxy image"
      });
    }
  });

  // Image adjustment endpoint
  app.post("/api/images/adjust", upload.single('imageFile'), async (req, res) => {
    try {
      const { provider, adjustmentPrompt, productId } = req.body;
      const imageFile = req.file as Express.Multer.File | undefined;

      console.log("Image adjustment request:", { provider, productId, hasImageFile: !!imageFile });

      if (!provider || !adjustmentPrompt || !imageFile) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: provider, adjustmentPrompt, and imageFile are required"
        });
      }

      // Get product for context (only if a specific product is selected)
      let product = null;
      if (productId && productId !== 'none') {
        product = await storage.getProduct(productId);
        if (!product) {
          return res.status(404).json({ success: false, error: "Product not found" });
        }
      }

      // Build adjustment prompt with product context (if available)
      const fullPrompt = product 
        ? `Product: ${product.name}
Offer Type: ${product.offerType}

Adjustment Request: ${adjustmentPrompt}

Apply the requested adjustments to this image while maintaining the overall style and quality.`
        : `Adjustment Request: ${adjustmentPrompt}

Apply the requested adjustments to this image while maintaining the overall style and quality.`;

      console.log("Adjustment prompt:", fullPrompt);

      let adjustedImage;

      if (provider === 'gpt') {
        // Use GPT Image 1.5 via kie.ai for adjustments
        try {
          const kieApiKey = process.env.SORA_VERIFIED_KEY;
          if (!kieApiKey) {
            return res.status(400).json({ success: false, error: "kie.ai API key not configured for GPT Image 1.5" });
          }

          console.log("Calling GPT Image 1.5 via kie.ai for adjustment");

          let publicUrl: string;
          const ext = path.extname(imageFile.originalname) || '.png';

          {
            const uploadsDir = path.join(process.cwd(), 'uploads');
            if (!fsSync.existsSync(uploadsDir)) {
              fsSync.mkdirSync(uploadsDir, { recursive: true });
            }
            const originalSize = imageFile.buffer.length;
            let saveBuffer: Buffer;
            let saveExt: string;

            if (originalSize > 1024 * 1024) {
              console.log(`[GPT Image 1.5 Adjust] Image is ${(originalSize / 1024 / 1024).toFixed(1)}MB, compressing to JPEG...`);
              saveBuffer = await sharp(imageFile.buffer)
                .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
              saveExt = '.jpg';
              console.log(`[GPT Image 1.5 Adjust] Compressed to ${(saveBuffer.length / 1024 / 1024).toFixed(1)}MB`);
            } else {
              saveBuffer = imageFile.buffer;
              saveExt = ext;
            }

            const filename = `gpt15-adj-${Date.now()}${saveExt}`;
            const filepath = path.join(uploadsDir, filename);
            fsSync.writeFileSync(filepath, saveBuffer);
            const host = req.get('host') || 'localhost:5000';
            const protocol = process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'http');
            publicUrl = `${protocol}://${host}/uploads/${filename}`;
            console.log(`[GPT Image 1.5 Adjust] Saved image locally: ${publicUrl}`);
          }

          const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${kieApiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-image/1.5-image-to-image',
              input: {
                input_urls: [publicUrl],
                prompt: fullPrompt,
                aspect_ratio: '1:1',
                quality: 'medium'
              }
            })
          });

          if (!createResponse.ok) {
            const errorText = await createResponse.text();
            throw new Error(`GPT Image 1.5 createTask failed: ${errorText}`);
          }

          const createResult = await createResponse.json();
          if (createResult.code !== 200 || !createResult.data?.taskId) {
            throw new Error(`GPT Image 1.5 createTask returned invalid response`);
          }

          const taskId = createResult.data.taskId;
          console.log(`[GPT Image 1.5 Adjust] Task created: ${taskId}`);

          // Poll for result
          const maxAttempts = 60;
          for (let attempts = 0; attempts < maxAttempts; attempts++) {
            await new Promise(resolve => setTimeout(resolve, 5000));

            const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
              headers: { 'Authorization': `Bearer ${kieApiKey}` }
            });

            if (!statusResponse.ok) continue;

            const statusResult = await statusResponse.json();
            if (statusResult.code === 200 && statusResult.data) {
              if (statusResult.data.state === 'success') {
                const resultData = JSON.parse(statusResult.data.resultJson || '{}');
                const imageUrls = resultData.resultUrls || [];
                if (imageUrls.length > 0) {
                  adjustedImage = {
                    url: imageUrls[0],
                    provider: 'gpt' as const
                  };
                }
                break;
              } else if (statusResult.data.state === 'fail') {
                throw new Error(`GPT Image 1.5 adjustment failed: ${statusResult.data.failMsg}`);
              }
            }
          }

          if (!adjustedImage) {
            throw new Error('GPT Image 1.5 adjustment timed out or produced no result');
          }
        } catch (error: any) {
          console.error("GPT Image 1.5 adjustment error:", error);
          return res.status(500).json({
            success: false,
            error: `GPT Image 1.5 adjustment failed: ${error.message}`
          });
        }
      } else if (provider === 'gemini') {
        // Use Gemini 2.0 multimodal for adjustments
        const hasGeminiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
        
        if (!hasGeminiKey) {
          return res.status(400).json({
            success: false,
            error: "Gemini API key not configured"
          });
        }

        try {
          console.log("Calling Gemini 2.0 for adjustment");
          console.log("Provider: gemini, Model: gemini-2.0-flash-preview-image-generation");
          
          const imageBuffer = imageFile.buffer;
          const base64Image = imageBuffer.toString('base64');
          
          const parts = [
            { text: fullPrompt },
            {
              inlineData: {
                mimeType: imageFile.mimetype,
                data: base64Image
              }
            }
          ];
          
          const response = await gemini.models.generateContent({
            model: "gemini-2.0-flash-preview-image-generation",
            contents: [{ role: "user", parts }],
            config: {
              responseModalities: [Modality.TEXT, Modality.IMAGE],
              safetySettings: [
                {
                  category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                  threshold: HarmBlockThreshold.BLOCK_NONE
                },
                {
                  category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                  threshold: HarmBlockThreshold.BLOCK_NONE
                },
                {
                  category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                  threshold: HarmBlockThreshold.BLOCK_NONE
                },
                {
                  category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                  threshold: HarmBlockThreshold.BLOCK_NONE
                }
              ]
            }
          });

          const candidates = response.candidates;
          if (candidates && candidates.length > 0) {
            const content = candidates[0].content;
            if (content && content.parts) {
              for (const part of content.parts) {
                if (part.inlineData && part.inlineData.data) {
                  const mimeType = part.inlineData.mimeType || 'image/png';
                  const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                  adjustedImage = {
                    url: dataUrl,
                    provider: 'gemini' as const
                  };
                  break;
                }
              }
            }
          }
        } catch (error: any) {
          console.error("Gemini 2.0 adjustment error:", error);
          return res.status(500).json({
            success: false,
            error: `Gemini 2.0 adjustment failed: ${error.message}`
          });
        }
      } else if (provider === 'gemini25') {
        // Use Gemini 2.5 Flash Image for adjustments
        const hasGeminiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
        
        if (!hasGeminiKey) {
          return res.status(400).json({
            success: false,
            error: "Gemini API key not configured"
          });
        }

        try {
          console.log("Calling Gemini 2.5 for adjustment");
          console.log("Provider: gemini25, Model: gemini-2.5-flash-image");
          
          const imageBuffer = imageFile.buffer;
          const base64Image = imageBuffer.toString('base64');
          
          const parts = [
            { text: fullPrompt },
            {
              inlineData: {
                mimeType: imageFile.mimetype,
                data: base64Image
              }
            }
          ];
          
          const response = await gemini.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [{ role: "user", parts }],
            config: {
              responseModalities: [Modality.TEXT, Modality.IMAGE],
              safetySettings: [
                {
                  category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                  threshold: HarmBlockThreshold.BLOCK_NONE
                },
                {
                  category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                  threshold: HarmBlockThreshold.BLOCK_NONE
                },
                {
                  category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                  threshold: HarmBlockThreshold.BLOCK_NONE
                },
                {
                  category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                  threshold: HarmBlockThreshold.BLOCK_NONE
                }
              ]
            }
          });

          const candidates = response.candidates;
          if (candidates && candidates.length > 0) {
            const content = candidates[0].content;
            if (content && content.parts) {
              for (const part of content.parts) {
                if (part.inlineData && part.inlineData.data) {
                  const mimeType = part.inlineData.mimeType || 'image/png';
                  const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                  adjustedImage = {
                    url: dataUrl,
                    provider: 'gemini25' as const
                  };
                  break;
                }
              }
            }
          }
        } catch (error: any) {
          console.error("Gemini 2.5 adjustment error:", error);
          return res.status(500).json({
            success: false,
            error: `Gemini 2.5 adjustment failed: ${error.message}`
          });
        }
      } else if (provider === 'imagen4') {
        // Imagen 4 does not support image-to-image adjustments (text-to-image only)
        return res.status(400).json({
          success: false,
          error: "Imagen 4 does not support image adjustments. It only supports text-to-image generation. Please use GPT, Gemini 2.0, or Gemini 2.5 for image adjustments."
        });
      } else {
        return res.status(400).json({
          success: false,
          error: "Invalid provider. Must be 'gpt', 'gemini', or 'gemini25'"
        });
      }

      if (!adjustedImage) {
        return res.status(500).json({
          success: false,
          error: "Failed to generate adjusted image"
        });
      }

      res.json({
        success: true,
        adjustedImage
      });
    } catch (error: any) {
      console.error("Image adjustment error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to adjust image"
      });
    }
  });

  // GIF resize endpoint - preserves animation using gifsicle/ImageMagick/ffmpeg
  app.post("/api/images/resize-gif", upload.single('gifFile'), async (req, res) => {
    try {
      const { width, height, cropMode, outputFormat } = req.body;
      const gifFile = req.file as Express.Multer.File | undefined;

      console.log("[GIF Resize] Request:", { 
        width, 
        height, 
        cropMode,
        outputFormat,
        hasFile: !!gifFile,
        mimeType: gifFile?.mimetype 
      });

      if (!gifFile) {
        return res.status(400).json({
          success: false,
          error: "GIF file is required"
        });
      }

      // Validate file is a GIF
      if (gifFile.mimetype !== 'image/gif') {
        return res.status(400).json({
          success: false,
          error: "File must be a GIF image"
        });
      }

      const targetWidth = parseInt(width) || 0;
      const targetHeight = parseInt(height) || 0;
      const convertToWebP = outputFormat === 'webp';

      if (targetWidth <= 0 && targetHeight <= 0) {
        return res.status(400).json({
          success: false,
          error: "At least width or height must be specified"
        });
      }

      // Create temp directory for processing
      const tempDir = path.join(process.cwd(), 'temp_gif_processing');
      await fs.mkdir(tempDir, { recursive: true });

      const inputPath = path.join(tempDir, `input_${Date.now()}.gif`);
      const resizedGifPath = path.join(tempDir, `resized_${Date.now()}.gif`);
      const outputPath = convertToWebP 
        ? path.join(tempDir, `output_${Date.now()}.webp`)
        : path.join(tempDir, `output_${Date.now()}.gif`);

      try {
        // Write input file
        await fs.writeFile(inputPath, gifFile.buffer);

        console.log("[GIF Resize] Processing:", { targetWidth, targetHeight, cropMode, convertToWebP });

        // Step 1: Resize the GIF
        const resizeOutputPath = convertToWebP ? resizedGifPath : outputPath;
        
        if (targetWidth > 0 && targetHeight > 0 && cropMode === 'crop') {
          // Use ImageMagick for high-quality center crop
          const command = `convert "${inputPath}" -coalesce -resize ${targetWidth}x${targetHeight}^ -gravity center -extent ${targetWidth}x${targetHeight} -layers optimize "${resizeOutputPath}"`;
          console.log("[GIF Resize] Running ImageMagick center crop:", command);
          
          const { stderr } = await execAsync(command, { timeout: 120000 });
          if (stderr && !stderr.includes('identify')) {
            console.log("[GIF Resize] ImageMagick stderr:", stderr);
          }
        } else if (targetWidth > 0 && targetHeight > 0) {
          // Stretch mode: use ImageMagick with exact dimensions
          const command = `convert "${inputPath}" -coalesce -resize ${targetWidth}x${targetHeight}! -layers optimize "${resizeOutputPath}"`;
          console.log("[GIF Resize] Running ImageMagick stretch:", command);
          
          const { stderr } = await execAsync(command, { timeout: 120000 });
          if (stderr && !stderr.includes('identify')) {
            console.log("[GIF Resize] ImageMagick stderr:", stderr);
          }
        } else {
          // Single dimension - use gifsicle for efficiency
          let resizeArg = '';
          if (targetWidth > 0) {
            resizeArg = `--resize-fit-width ${targetWidth}`;
          } else if (targetHeight > 0) {
            resizeArg = `--resize-fit-height ${targetHeight}`;
          }

          const command = `gifsicle ${resizeArg} -O3 --colors 256 "${inputPath}" -o "${resizeOutputPath}"`;
          console.log("[GIF Resize] Running gifsicle:", command);
          await execAsync(command, { timeout: 60000 });
        }

        // Verify resized GIF exists
        const resizeExists = await fs.stat(resizeOutputPath).catch(() => null);
        if (!resizeExists) {
          throw new Error("GIF resize failed - output file not created");
        }

        // Step 2: Convert to WebP if requested
        if (convertToWebP) {
          // Use ffmpeg to convert animated GIF to animated WebP
          const webpCommand = `ffmpeg -y -i "${resizedGifPath}" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 80 -loop 0 -preset default -an -vsync 0 "${outputPath}"`;
          console.log("[GIF Resize] Converting to WebP:", webpCommand);
          
          const { stderr } = await execAsync(webpCommand, { timeout: 120000 });
          if (stderr && !stderr.toLowerCase().includes('error')) {
            console.log("[GIF Resize] ffmpeg output (non-error):", stderr.slice(0, 200));
          }
          
          // Clean up intermediate GIF
          await fs.unlink(resizedGifPath).catch(() => {});
        }

        // Verify final output file exists
        const outputExists = await fs.stat(outputPath).catch(() => null);
        if (!outputExists) {
          throw new Error("GIF processing failed - output file not created");
        }

        // Read result
        const resultBuffer = await fs.readFile(outputPath);
        const base64 = resultBuffer.toString('base64');

        // Get output dimensions using ffprobe for WebP, gifsicle for GIF
        let outputWidth = targetWidth;
        let outputHeight = targetHeight;
        
        if (convertToWebP) {
          try {
            const probeOutput = await execAsync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${outputPath}"`);
            const dims = probeOutput.stdout.trim().split('x');
            if (dims.length === 2) {
              outputWidth = parseInt(dims[0]) || targetWidth;
              outputHeight = parseInt(dims[1]) || targetHeight;
            }
          } catch (e) {
            console.log("[GIF Resize] Could not probe WebP dimensions, using target");
          }
        } else {
          const sizeOutput = await execAsync(`gifsicle --sinfo "${outputPath}" 2>&1 | head -5`);
          const dimMatch = sizeOutput.stdout.match(/logical screen (\d+)x(\d+)/);
          if (dimMatch) {
            outputWidth = parseInt(dimMatch[1]);
            outputHeight = parseInt(dimMatch[2]);
          }
        }

        // Clean up temp files
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});

        const mimeType = convertToWebP ? 'image/webp' : 'image/gif';
        const format = convertToWebP ? 'WEBP' : 'GIF';
        
        console.log("[GIF Resize] Success:", { outputWidth, outputHeight, size: resultBuffer.length, format });

        res.json({
          success: true,
          result: {
            dataUrl: `data:${mimeType};base64,${base64}`,
            width: outputWidth,
            height: outputHeight,
            size: resultBuffer.length,
            format
          }
        });
      } catch (processError: any) {
        // Clean up on error
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(resizedGifPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        throw processError;
      }
    } catch (error: any) {
      console.error("[GIF Resize] Error:", error);
      res.status(500).json({
        success: false,
        error: `Failed to resize GIF: ${error.message}`
      });
    }
  });

  // Generate image prompts using Claude with vision
  app.post("/api/image-prompts/generate", upload.none(), async (req, res) => {
    try {
      const { idea, referenceImages, referenceImageMtpKeys } = req.body;
      
      const mtpKeys = referenceImageMtpKeys ? (Array.isArray(referenceImageMtpKeys) ? referenceImageMtpKeys : [referenceImageMtpKeys]) : [];
      const base64Images = referenceImages ? (Array.isArray(referenceImages) ? referenceImages : [referenceImages]) : [];
      const totalRefImages = base64Images.length + mtpKeys.length;
      
      console.log("[Image Prompts] Request:", { 
        hasIdea: !!idea?.trim(), 
        base64ImageCount: base64Images.length,
        mtpKeyCount: mtpKeys.length
      });

      if (!idea?.trim() && totalRefImages === 0) {
        return res.status(400).json({
          success: false,
          error: "Either an idea or reference images must be provided"
        });
      }

      // Build the message content
      const content: any[] = [];
      
      // Add text prompt if provided
      if (idea?.trim()) {
        content.push({
          type: "text",
          text: `Generate exactly 12 detailed, thorough image prompts for AI image generation based on this idea:

${idea}

Each prompt should be:
- Highly detailed and specific
- Include visual elements, lighting, composition, style, mood
- Optimized for AI image generation (DALL-E, Nano Banana Pro, Gemini, Imagen)
- Different from each other to provide variety
- Professional and suitable for marketing materials

Return the prompts as a JSON object with this structure:
{
  "prompts": ["prompt 1", "prompt 2", ...]
}`
        });
      }

      // Add base64 reference images if provided (with compression for Claude's 5MB limit)
      if (base64Images.length > 0) {
        for (let i = 0; i < Math.min(base64Images.length, 5); i++) {
          const originalDataUrl = base64Images[i];
          const compressedDataUrl = await compressImageForClaude(originalDataUrl);
          
          const mediaTypeMatch = compressedDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
          const mediaType = mediaTypeMatch ? mediaTypeMatch[1] : "image/png";
          
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: compressedDataUrl.split(',')[1] || compressedDataUrl
            }
          });
        }
      }

      // Add MTP library images by fetching from R2
      if (mtpKeys.length > 0 && r2Client) {
        for (let i = 0; i < Math.min(mtpKeys.length, 5); i++) {
          try {
            const command = new GetObjectCommand({
              Bucket: R2_BUCKET_NAME,
              Key: mtpKeys[i],
            });
            const r2Response = await r2Client.send(command);
            if (r2Response.Body) {
              const chunks: Buffer[] = [];
              const stream = r2Response.Body as NodeJS.ReadableStream;
              for await (const chunk of stream) {
                chunks.push(Buffer.from(chunk));
              }
              const buffer = Buffer.concat(chunks);
              const base64Data = buffer.toString('base64');
              const mediaType = r2Response.ContentType || 'image/png';
              
              const dataUrl = `data:${mediaType};base64,${base64Data}`;
              const compressedDataUrl = await compressImageForClaude(dataUrl);
              const compressedMediaMatch = compressedDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
              const compressedMediaType = compressedMediaMatch ? compressedMediaMatch[1] : mediaType;
              
              content.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: compressedMediaType,
                  data: compressedDataUrl.split(',')[1] || compressedDataUrl
                }
              });
              console.log(`[Image Prompts] Added MTP image: ${mtpKeys[i]}`);
            }
          } catch (err) {
            console.error(`[Image Prompts] Failed to fetch MTP image ${mtpKeys[i]}:`, err);
          }
        }
      }

      // Add analysis instruction for reference images
      if (totalRefImages > 0 && content.some(c => c.type === 'image')) {
        content.push({
          type: "text",
          text: idea?.trim() 
            ? `Using the reference image(s) above as inspiration, incorporate their visual style, composition, lighting, and aesthetic into the generated prompts.`
            : `Analyze the reference image(s) above and generate exactly 12 detailed, thorough image prompts that capture similar visual styles, compositions, lighting, and aesthetics. Each prompt should be highly specific and optimized for AI image generation.

Return the prompts as a JSON object with this structure:
{
  "prompts": ["prompt 1", "prompt 2", ...]
}`
        });
      }

      console.log("[Image Prompts] Calling Claude with", content.length, "content items");

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content
        }]
      });

      console.log("[Image Prompts] Claude response received");

      // Extract the text content
      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error("No text response from Claude");
      }

      // Parse the JSON response
      const jsonMatch = textContent.text.match(/\{[\s\S]*"prompts"[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("[Image Prompts] Failed to parse JSON from response:", textContent.text);
        throw new Error("Failed to parse prompts from Claude response");
      }

      const result = JSON.parse(jsonMatch[0]);
      
      console.log("[Image Prompts] Generated", result.prompts?.length || 0, "prompts");

      res.json({
        success: true,
        prompts: result.prompts || []
      });

    } catch (error: any) {
      console.error("[Image Prompts] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to generate prompts"
      });
    }
  });

  // Generate video prompts using Claude with vision
  app.post("/api/video-prompts/generate", upload.none(), async (req, res) => {
    try {
      const { idea, referenceImages, referenceImageMtpKeys } = req.body;

      const mtpKeys = referenceImageMtpKeys ? (Array.isArray(referenceImageMtpKeys) ? referenceImageMtpKeys : [referenceImageMtpKeys]) : [];
      const base64Images = referenceImages ? (Array.isArray(referenceImages) ? referenceImages : [referenceImages]) : [];
      const totalRefImages = base64Images.length + mtpKeys.length;

      console.log("[Video Prompts] Request:", {
        hasIdea: !!idea?.trim(),
        base64ImageCount: base64Images.length,
        mtpKeyCount: mtpKeys.length,
      });

      if (!idea?.trim() && totalRefImages === 0) {
        return res.status(400).json({
          success: false,
          error: "Either an idea or reference images must be provided"
        });
      }

      // Build the message content
      const content: any[] = [];
      
      // Add text prompt if provided
      if (idea?.trim()) {
        content.push({
          type: "text",
          text: `Generate 5-7 detailed video prompts for AI video generation (Sora, Veo) based on this idea:

${idea}

Each video prompt should include:
- Detailed scene description and visual elements
- Camera movement (pan, tilt, dolly, crane, handheld, static, etc.)
- Motion dynamics (slow motion, time-lapse, real-time, speed ramping)
- Lighting and atmosphere (dramatic, soft, natural, cinematic, etc.)
- Pacing and rhythm (fast cuts, slow builds, transitions)
- Visual style (cinematic, documentary, commercial, artistic, etc.)
- Subject movement and action
- Mood and emotional tone

Each prompt should be:
- Highly detailed and specific (100-200 words)
- Optimized for AI video generation models
- Different from each other to provide variety
- Professional and suitable for marketing videos

Return the prompts as a JSON object with this structure:
{
  "prompts": ["prompt 1", "prompt 2", ...]
}`
        });
      }

      // Add base64 reference images (with compression for Claude's 5MB limit)
      if (base64Images.length > 0) {
        for (let i = 0; i < Math.min(base64Images.length, 5); i++) {
          const originalDataUrl = base64Images[i];
          const compressedDataUrl = await compressImageForClaude(originalDataUrl);
          const mediaTypeMatch = compressedDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
          const mediaType = mediaTypeMatch ? mediaTypeMatch[1] : "image/png";
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: compressedDataUrl.split(',')[1] || compressedDataUrl
            }
          });
        }
      }

      // Add MTP library images by fetching from R2
      if (mtpKeys.length > 0 && r2Client) {
        for (let i = 0; i < Math.min(mtpKeys.length, 5); i++) {
          try {
            const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: mtpKeys[i] });
            const r2Response = await r2Client.send(command);
            if (r2Response.Body) {
              const chunks: Buffer[] = [];
              const stream = r2Response.Body as NodeJS.ReadableStream;
              for await (const chunk of stream) { chunks.push(Buffer.from(chunk)); }
              const buffer = Buffer.concat(chunks);
              const dataUrl = `data:${r2Response.ContentType || 'image/png'};base64,${buffer.toString('base64')}`;
              const compressedDataUrl = await compressImageForClaude(dataUrl);
              const compressedMediaMatch = compressedDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
              const compressedMediaType = compressedMediaMatch ? compressedMediaMatch[1] : 'image/png';
              content.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: compressedMediaType,
                  data: compressedDataUrl.split(',')[1] || compressedDataUrl
                }
              });
              console.log(`[Video Prompts] Added MTP image: ${mtpKeys[i]}`);
            }
          } catch (err) {
            console.error(`[Video Prompts] Failed to fetch MTP image ${mtpKeys[i]}:`, err);
          }
        }
      }

      // Add analysis instruction when reference images are present
      if (totalRefImages > 0 && content.some(c => c.type === 'image')) {
        content.push({
          type: "text",
          text: idea?.trim()
            ? `Using the reference image(s) above as inspiration, imagine how these scenes could come to life as video. Incorporate their visual style, composition, lighting, and aesthetic into the generated video prompts. Think about what movement, camera work, and motion would enhance these visuals.`
            : `Analyze the reference image(s) above and generate 5-7 detailed video prompts that bring these visuals to life as dynamic video content. For each prompt, imagine:
- How the scene would move and evolve over time
- What camera movements would enhance the composition
- How subjects or elements would animate
- The pacing and rhythm of the video
- Transitions and visual effects

Each prompt should be highly specific and optimized for AI video generation (Sora, Veo).

Return the prompts as a JSON object with this structure:
{
  "prompts": ["prompt 1", "prompt 2", ...]
}`
        });
      }

      console.log("[Video Prompts] Calling Claude with", content.length, "content items");

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 6000,
        messages: [{
          role: "user",
          content
        }]
      });

      console.log("[Video Prompts] Claude response received");

      // Extract the text content
      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error("No text response from Claude");
      }

      // Parse the JSON response
      const jsonMatch = textContent.text.match(/\{[\s\S]*"prompts"[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("[Video Prompts] Failed to parse JSON from response:", textContent.text);
        throw new Error("Failed to parse prompts from Claude response");
      }

      const result = JSON.parse(jsonMatch[0]);
      
      console.log("[Video Prompts] Generated", result.prompts?.length || 0, "prompts");

      res.json({
        success: true,
        prompts: result.prompts || []
      });

    } catch (error: any) {
      console.error("[Video Prompts] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to generate video prompts"
      });
    }
  });

  // Generate 10 advertorial angles using GPT-5
  app.post("/api/generate-advertorial-angles", async (req, res) => {
    try {
      console.log("Generating advertorial angles request:", req.body);
      const { productName, salesPageLink } = req.body;

      if (!productName || !salesPageLink) {
        console.log("Missing required fields:", { productName, salesPageLink });
        return res.status(400).json({
          success: false,
          error: "Product name and sales page link are required"
        });
      }

      const prompt = `You are an expert marketing copywriter. Create 10 different article angle ideas for promoting this product.

Product: ${productName}
Sales Page: ${salesPageLink}

For each angle, provide:
1. A compelling headline
2. A one-sentence description of the angle

Create diverse angles using different approaches: news style, story-driven, benefit-focused, problem-solution, comparison, testimonial-based, etc.

Return ONLY valid JSON in this exact format:
{
  "angles": [
    {
      "headline": "example headline here",
      "overview": "one sentence overview here"
    }
  ]
}`;

      console.log("Calling OpenAI for advertorial angles...");
      const completion = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 4000
      });

      console.log("OpenAI response received");
      console.log("Finish reason:", completion.choices[0].finish_reason);
      
      const rawContent = completion.choices[0].message.content;
      if (!rawContent) {
        console.log("No content in OpenAI response");
        console.log("Full completion object:", JSON.stringify(completion, null, 2));
        return res.status(500).json({
          success: false,
          error: "No response from AI - finish_reason: " + completion.choices[0].finish_reason
        });
      }

      const result = JSON.parse(rawContent);
      console.log(`Generated ${result.angles?.length || 0} angles`);
      
      res.json({
        success: true,
        angles: result.angles || []
      });
    } catch (error: any) {
      console.error("Error generating advertorial angles:", error);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to generate advertorial angles"
      });
    }
  });

  // Helper function to convert markdown to HTML
  function markdownToHtml(text: string): string {
    if (!text) return '';
    
    let html = text;
    
    // Convert headings (## Heading -> <h2>Heading</h2>)
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    
    // Convert bold (**text** -> <strong>text</strong>)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Convert italic (*text* -> <em>text</em>)
    // Process after bold so ** are already converted
    // Only use asterisks, not underscores, to avoid breaking URLs and snake_case
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Convert bullet lists (lines starting with - or * -> <ul><li>)
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // Convert paragraphs (double newlines -> <p> tags)
    // First, protect already converted HTML elements
    const paragraphs = html.split('\n\n');
    html = paragraphs.map(para => {
      para = para.trim();
      if (!para) return '';
      // Don't wrap headings, lists in <p> tags
      if (para.startsWith('<h2>') || para.startsWith('<ul>')) {
        return para;
      }
      // Remove single newlines within paragraphs
      para = para.replace(/\n/g, ' ');
      return `<p>${para}</p>`;
    }).join('\n');
    
    return html;
  }

  // Generate full advertorial articles for selected angles (2 from GPT-5, 2 from Claude)
  app.post("/api/generate-advertorial-articles", async (req, res) => {
    try {
      const { productName, salesPageLink, angles } = req.body;

      if (!productName || !salesPageLink || !angles || !Array.isArray(angles)) {
        return res.status(400).json({
          success: false,
          error: "Product name, sales page link, and angles array are required"
        });
      }

      // Generate articles for each angle
      const articlePromises = angles.map(async (angle: { headline: string; overview: string }) => {
        const basePrompt = `You are an expert advertorial copywriter. Write a compelling, full-length advertorial article for this product.

Product: ${productName}
Sales Page Link: ${salesPageLink}

Angle: ${angle.headline}
Overview: ${angle.overview}

Write a complete advertorial article following these guidelines:
- Write in an editorial/news style that doesn't feel like an ad
- Hook readers with the angle's headline and overview
- Build credibility and trust through storytelling
- Naturally weave in the product benefits
- Use engaging, conversational language
- Include relevant facts, statistics, or social proof when appropriate
- End with a clear but soft call-to-action
- Length: 400-800 words
- Use markdown formatting for emphasis (bold, italic) and structure (headings, lists) as needed
- Write naturally and focus on compelling copy

Return valid JSON:
{
  "article": "full article text here with markdown formatting"
}`;

        // Generate 2 variations from GPT-5 and 2 from Claude in parallel
        const [gpt1, gpt2, claude1, claude2] = await Promise.all([
          // GPT-5 Variation 1
          openai.chat.completions.create({
            model: "gpt-5",
            messages: [{ role: "user", content: basePrompt }],
            response_format: { type: "json_object" },
            max_completion_tokens: 3000
          }).then(response => {
            const content = response.choices[0].message.content;
            return content ? JSON.parse(content).article : "";
          }).catch(error => {
            console.error("GPT-5 v1 error:", error);
            return "";
          }),

          // GPT-5 Variation 2
          openai.chat.completions.create({
            model: "gpt-5",
            messages: [{ role: "user", content: basePrompt + "\n\nCreate a unique variation with a different approach and tone." }],
            response_format: { type: "json_object" },
            max_completion_tokens: 3000
          }).then(response => {
            const content = response.choices[0].message.content;
            return content ? JSON.parse(content).article : "";
          }).catch(error => {
            console.error("GPT-5 v2 error:", error);
            return "";
          }),

          // Claude Variation 1
          anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 3000,
            messages: [{ role: "user", content: basePrompt }]
          }).then(response => {
            const content = response.content[0];
            if (content.type === 'text') {
              const text = content.text.trim();
              // Handle potential markdown code fence wrapping
              const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
              const jsonStr = jsonMatch ? jsonMatch[1] : text;
              return JSON.parse(jsonStr).article;
            }
            return "";
          }).catch(error => {
            console.error("Claude v1 error:", error);
            return "";
          }),

          // Claude Variation 2
          anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 3000,
            messages: [{ role: "user", content: basePrompt + "\n\nCreate a unique variation with a different approach and tone." }]
          }).then(response => {
            const content = response.content[0];
            if (content.type === 'text') {
              const text = content.text.trim();
              // Handle potential markdown code fence wrapping
              const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
              const jsonStr = jsonMatch ? jsonMatch[1] : text;
              return JSON.parse(jsonStr).article;
            }
            return "";
          }).catch(error => {
            console.error("Claude v2 error:", error);
            return "";
          })
        ]);

        return {
          angle,
          articles: {
            gptV1: markdownToHtml(gpt1),
            gptV2: markdownToHtml(gpt2),
            claudeV1: markdownToHtml(claude1),
            claudeV2: markdownToHtml(claude2)
          }
        };
      });

      const articles = await Promise.all(articlePromises);

      res.json({
        success: true,
        articles
      });
    } catch (error: any) {
      console.error("Error generating advertorial articles:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to generate advertorial articles"
      });
    }
  });

  // kie.ai Veo helper functions for fallback
  async function generateVeoVideoWithKieAi(params: {
    prompt: string;
    model: 'veo3' | 'veo3_fast';
    generationType: 'TEXT_2_VIDEO' | 'FIRST_AND_LAST_FRAMES_2_VIDEO' | 'REFERENCE_2_VIDEO';
    imageUrls?: string[];
    aspectRatio?: '16:9' | '9:16' | 'Auto';
  }): Promise<{ taskId: string }> {
    console.log(`[kie.ai/Veo] Initiating generation with model: ${params.model}`);
    
    const kieApiKey = process.env.SORA_VERIFIED_KEY;
    if (!kieApiKey) {
      throw new Error('kie.ai API key not configured');
    }

    const requestBody = {
      prompt: params.prompt,
      model: params.model,
      generationType: params.generationType,
      imageUrls: params.imageUrls,
      aspectRatio: params.aspectRatio || '16:9',
      enableTranslation: true
    };
    
    console.log(`[kie.ai/Veo] Request body:`, JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.kie.ai/api/v1/veo/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kieApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`[kie.ai/Veo] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[kie.ai/Veo] Error response:`, errorText);
      throw new Error(`kie.ai API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log(`[kie.ai/Veo] Response data:`, JSON.stringify(data, null, 2));
    
    if (data.code !== 200) {
      console.error(`[kie.ai/Veo] API returned error code: ${data.code}, message: ${data.msg}`);
      throw new Error(`kie.ai error: ${data.msg || 'Unknown error'}`);
    }

    console.log(`[kie.ai/Veo] Task created with ID: ${data.data.taskId}`);
    return { taskId: data.data.taskId };
  }

  async function pollKieAiVeoTask(taskId: string, maxAttempts = 60): Promise<string> {
    console.log(`[kie.ai/Veo] Starting to poll task: ${taskId} (max ${maxAttempts} attempts)`);
    
    const kieApiKey = process.env.SORA_VERIFIED_KEY;
    if (!kieApiKey) {
      throw new Error('kie.ai API key not configured');
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      console.log(`[kie.ai/Veo] Poll attempt ${attempt + 1}/${maxAttempts} for task ${taskId}`);
      
      // Use correct polling endpoint from official docs
      const response = await fetch(`https://api.kie.ai/api/v1/veo/record-info?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${kieApiKey}`
        }
      });

      console.log(`[kie.ai/Veo] Poll response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[kie.ai/Veo] Poll error response:`, errorText);
        throw new Error(`kie.ai polling error: ${response.status}`);
      }

      const result = await response.json();
      console.log(`[kie.ai/Veo] Poll response data:`, JSON.stringify(result, null, 2));
      
      // Check response format: result.code should be 200 for valid response
      if (result.code === 200 && result.data) {
        const data = result.data;
        
        // successFlag: 0=generating, 1=success, 2=failed, 3=generation failed
        if (data.successFlag === 1) {
          // Success! Get video URL from response object
          if (data.response && data.response.resultUrls && data.response.resultUrls.length > 0) {
            const videoUrl = data.response.resultUrls[0];
            console.log(`[kie.ai/Veo] Task completed successfully! Video URL: ${videoUrl}`);
            return videoUrl;
          } else {
            console.error(`[kie.ai/Veo] Success but no video URLs found in response`);
            throw new Error('No video URLs in successful response');
          }
        } else if (data.successFlag === 2 || data.successFlag === 3) {
          console.error(`[kie.ai/Veo] Task failed: ${result.msg || 'Unknown error'}`);
          throw new Error(`kie.ai generation failed: ${result.msg || 'Unknown error'}`);
        } else if (data.successFlag === 0) {
          // Still generating
          console.log(`[kie.ai/Veo] Task still generating, waiting 30s before next poll...`);
        } else {
          console.warn(`[kie.ai/Veo] Unexpected successFlag: ${data.successFlag}`);
        }
      } else {
        console.warn(`[kie.ai/Veo] Unexpected response structure. Code: ${result.code}`);
      }

      // Wait 30 seconds before next poll (recommended in docs)
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    console.error(`[kie.ai/Veo] Task ${taskId} timed out after ${maxAttempts} attempts`);
    throw new Error('kie.ai video generation timeout');
  }

  // Generate videos with Server-Sent Events for progressive updates
  app.post("/api/generate-videos-stream", upload.array('referenceImage', 5), async (req, res) => {
    try {
      const { productId, promptDetails, generationType, duration, amount, aspectRatio } = req.body;
      const referenceImageFiles = req.files as Express.Multer.File[] | undefined;
      const referenceImage = referenceImageFiles && referenceImageFiles.length > 0 ? referenceImageFiles[0] : undefined;
      
      // Set headers for SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in nginx
      
      // Send initial status
      res.write(`data: ${JSON.stringify({ type: 'status', message: 'Starting video generation...' })}\n\n`);
      
      // Validate and parse amount with bounds checking
      let videoAmount = 1; // default
      if (amount !== undefined && amount !== null) {
        const parsedAmount = parseInt(amount);
        if (isNaN(parsedAmount) || parsedAmount < 1 || parsedAmount > 4) {
          res.write(`data: ${JSON.stringify({ type: 'error', provider: 'validation', error: 'Amount must be between 1 and 4' })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          res.write('\n');
          res.end();
          return;
        }
        videoAmount = parsedAmount;
      }
      
      // Validate and parse duration with bounds checking
      let videoDuration = 8; // default
      if (duration !== undefined && duration !== null) {
        const parsedDuration = parseInt(duration);
        if (isNaN(parsedDuration) || parsedDuration < 1 || parsedDuration > 8) {
          res.write(`data: ${JSON.stringify({ type: 'error', provider: 'validation', error: 'Duration must be between 1 and 8 seconds' })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          res.write('\n');
          res.end();
          return;
        }
        videoDuration = parsedDuration;
      }
      
      // Validate required fields
      if (!promptDetails || typeof promptDetails !== 'string' || promptDetails.trim().length === 0) {
        res.write(`data: ${JSON.stringify({ type: 'error', provider: 'validation', error: 'Prompt details are required' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.write('\n');
        res.end();
        return;
      }

      if (!generationType || !['text-to-video', 'image-to-video'].includes(generationType)) {
        res.write(`data: ${JSON.stringify({ type: 'error', provider: 'validation', error: 'Valid generation type required' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.write('\n');
        res.end();
        return;
      }
      
      // Validate aspect ratio if provided
      if (aspectRatio && !['16:9', '9:16', '1:1'].includes(aspectRatio)) {
        res.write(`data: ${JSON.stringify({ type: 'error', provider: 'validation', error: 'Invalid aspect ratio' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.write('\n');
        res.end();
        return;
      }

      // Get product details if provided
      let productContext = "";
      if (productId && productId !== "none") {
        const product = await storage.getProduct(productId);
        if (product) {
          productContext = `Product: ${product.displayName || product.name}\nOffer Type: ${product.offerType}\n\n${product.manualContent}`;
        }
      }

      // Build full prompt with context
      const fullPrompt = productContext 
        ? `${productContext}\n\nVideo Concept: ${promptDetails}`
        : promptDetails;

      // Save all reference images to disk and generate public URLs
      const referenceImageUrls: string[] = [];
      let referenceImageBase64: string | null = null;
      let referenceImageMimeType: string | null = null;
      if (referenceImageFiles && referenceImageFiles.length > 0) {
        const fs = await import('fs');
        const path = await import('path');
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const host = req.get('host') || 'localhost:5000';
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'http');
        for (const imgFile of referenceImageFiles) {
          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(7);
          const ext = path.extname(imgFile.originalname);
          const filename = `ref-${timestamp}-${randomStr}${ext}`;
          const filepath = path.join(uploadsDir, filename);
          fs.writeFileSync(filepath, imgFile.buffer);
          referenceImageUrls.push(`${protocol}://${host}/uploads/${filename}`);
        }
        // Use first image for base64 (Veo/Gemini use single image)
        const base64 = referenceImageFiles[0].buffer.toString('base64');
        referenceImageBase64 = base64;
        referenceImageMimeType = referenceImageFiles[0].mimetype;
      }
      const referenceImageUrl = referenceImageUrls.length > 0 ? referenceImageUrls[0] : null;

      // Generate videos in parallel but stream results as they complete
      // Run both generators without awaiting - they'll stream results independently
      Promise.all([
        // Sora 2 generation (kie.ai)
        (async () => {
          try {
            res.write(`data: ${JSON.stringify({ type: 'status', provider: 'sora', message: 'Starting Sora 2 generation...' })}\n\n`);
            
            const kieApiKey = process.env.SORA_VERIFIED_KEY;
            if (!kieApiKey) {
              throw new Error('SORA_VERIFIED_KEY not configured');
            }
            
            // Create video generation requests based on amount
            for (let i = 0; i < videoAmount; i++) {
              try {
                // Determine model based on generation type
                const model = (generationType === 'image-to-video' && referenceImageUrl)
                  ? 'sora-2-image-to-video'
                  : 'sora-2-text-to-video';

                // Convert aspect ratio to portrait/landscape format
                const aspectRatioFormat = aspectRatio === '9:16' ? 'portrait' : 'landscape';
                
                // Convert duration (seconds) to n_frames ("10" or "15")
                const nFrames = videoDuration >= 15 ? "15" : "10";

                // Build kie.ai task parameters with input object
                const taskParams: any = {
                  model,
                  input: {
                    prompt: fullPrompt,
                    aspect_ratio: aspectRatioFormat,
                    n_frames: nFrames,
                    remove_watermark: true
                  }
                };

                // Add image URLs for image-to-video mode (Sora supports multiple)
                if (model === 'sora-2-image-to-video' && referenceImageUrls.length > 0) {
                  taskParams.input.image_urls = referenceImageUrls;
                }

                // Create task via kie.ai API
                const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${kieApiKey}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(taskParams)
                });

                if (!createResponse.ok) {
                  const errorText = await createResponse.text();
                  throw new Error(`kie.ai createTask failed: ${createResponse.status} ${errorText}`);
                }

                const createResult = await createResponse.json();
                const taskId = createResult.data?.taskId || createResult.data?.task_id || 
                               createResult.taskId || createResult.task_id || createResult.id;

                if (!taskId) {
                  throw new Error('No taskId returned from kie.ai');
                }

                // Poll for completion using jobs/recordInfo endpoint
                let attempts = 0;
                const maxAttempts = 60; // 10 minutes max
                let taskComplete = false;
                let videoUrl = null;
                
                while (!taskComplete && attempts < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
                  
                  const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${kieApiKey}`,
                      'Content-Type': 'application/json'
                    }
                  });

                  if (!statusResponse.ok) {
                    const errorText = await statusResponse.text();
                    throw new Error(`kie.ai status check failed: ${statusResponse.status} - ${errorText}`);
                  }

                  const statusResult = await statusResponse.json();
                  const data = statusResult.data || statusResult;
                  const status = data.state || data.status;
                  
                  if (status === 'completed' || status === 'success' || status === 'SUCCESS') {
                    taskComplete = true;
                    
                    // Try to extract video URL from resultJson (if present) or other fields
                    if (data.resultJson) {
                      try {
                        const result = JSON.parse(data.resultJson);
                        videoUrl = result.resultUrls?.[0] || result.resultWaterMarkUrls?.[0];
                      } catch (e) {
                        console.error('[Sora/kie.ai] Failed to parse resultJson:', e);
                      }
                    }
                    
                    // Fallback to other possible URL fields
                    if (!videoUrl) {
                      videoUrl = data.output?.video_url || data.videoUrl || data.url || data.video_url;
                    }
                  } else if (status === 'failed' || status === 'error' || status === 'FAILED') {
                    throw new Error(`Video generation failed: ${data.errorMessage || data.message || statusResult.msg || 'Unknown error'}`);
                  }
                  
                  attempts++;
                }

                if (!taskComplete) {
                  throw new Error('Sora video generation timed out after 10 minutes');
                }

                if (videoUrl) {
                  // Download video and convert to base64
                  const videoResponse = await fetch(videoUrl);
                  if (!videoResponse.ok) {
                    throw new Error(`Failed to download video: ${videoResponse.statusText}`);
                  }
                  
                  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
                  const videoBase64 = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;
                  
                  // Stream this video result immediately
                  res.write(`data: ${JSON.stringify({ 
                    type: 'video', 
                    provider: 'sora', 
                    url: videoBase64,
                    index: i
                  })}\n\n`);
                }
              } catch (error: any) {
                console.error(`Sora video ${i + 1} error:`, error);
                res.write(`data: ${JSON.stringify({ 
                  type: 'error', 
                  provider: 'sora', 
                  error: error.message,
                  index: i
                })}\n\n`);
              }
            }
            
            res.write(`data: ${JSON.stringify({ type: 'complete', provider: 'sora' })}\n\n`);
          } catch (error: any) {
            console.error("Sora generation error:", error);
            res.write(`data: ${JSON.stringify({ type: 'error', provider: 'sora', error: error.message })}\n\n`);
          }
        })(),

        // Veo generation with cascading fallbacks (Google Gemini)
        (async () => {
          try {
            res.write(`data: ${JSON.stringify({ type: 'status', provider: 'veo', message: 'Starting Veo generation...' })}\n\n`);
            
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

            // Define fallback models in order: Veo 3.1 (kie.ai) → Veo 3.1 Fast (kie.ai) → Veo 3 → Veo 3 Fast → Veo 2
            const fallbackModels = [
              { name: 'Veo 3.1', id: 'veo3', provider: 'kie' }, // kie.ai
              { name: 'Veo 3.1 Fast', id: 'veo3_fast', provider: 'kie' }, // kie.ai
              { name: 'Veo 3', id: 'veo-3.0-generate-preview', provider: 'google' },
              { name: 'Veo 3 Fast', id: 'veo-3.0-fast-generate-preview', provider: 'google' },
              { name: 'Veo 2', id: 'veo-2.0-generate-001', provider: 'google' }
            ];

            // Create video generation requests based on amount
            for (let i = 0; i < videoAmount; i++) {
              try {
                const configParams: any = {};

                // Add aspect ratio if specified
                if (aspectRatio) {
                  configParams.aspectRatio = aspectRatio;
                }

                // Build base video generation parameters
                const videoParams: any = {
                  model: '', // Will be set in fallback loop
                  config: configParams
                };
                
                // Note: Image format will be set per-model in the loop below
                // Veo 3.x models use source.referenceImages format
                // Veo 2 uses root-level image format

                let operation: any;
                let usedModel = fallbackModels[0]; // Track which model succeeded  
                let usedKieAi = false; // Track if we used kie.ai (skip Google polling)
                
                // Try each model in sequence until one works
                for (let modelIdx = 0; modelIdx < fallbackModels.length; modelIdx++) {
                  const currentModel = fallbackModels[modelIdx];
                  
                  try {
                    console.log(`[Veo] Attempting with ${currentModel.name} (${i + 1}/${videoAmount}) via ${currentModel.provider}`);
                    res.write(`data: ${JSON.stringify({ 
                      type: 'status', 
                      provider: 'veo', 
                      message: `Trying ${currentModel.name}...`,
                      model: currentModel.name
                    })}\n\n`);
                    
                    // Check if this is a kie.ai model
                    if (currentModel.provider === 'kie') {
                      // Use kie.ai API for Veo 3.1 models
                      console.log(`[Veo/kie.ai] Using kie.ai for ${currentModel.name}`);
                      
                      // Determine generation type for kie.ai
                      let kieGenType: 'TEXT_2_VIDEO' | 'FIRST_AND_LAST_FRAMES_2_VIDEO' = 'TEXT_2_VIDEO';
                      let imageUrls: string[] | undefined = undefined;
                      
                      if (generationType === 'image-to-video' && referenceImageUrl) {
                        kieGenType = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
                        imageUrls = [referenceImageUrl];
                      }
                      
                      // Convert aspect ratio for kie.ai (they use same format)
                      const kieAspectRatio = aspectRatio as '16:9' | '9:16' | undefined;
                      
                      // Start kie.ai generation
                      const { taskId } = await generateVeoVideoWithKieAi({
                        prompt: fullPrompt,
                        model: currentModel.id as 'veo3' | 'veo3_fast',
                        generationType: kieGenType,
                        imageUrls,
                        aspectRatio: kieAspectRatio
                      });
                      
                      console.log(`[Veo/kie.ai] Started task ${taskId}, polling...`);
                      
                      // Poll for completion
                      const videoUrl = await pollKieAiVeoTask(taskId);
                      
                      console.log(`[Veo/kie.ai] ${currentModel.name} completed successfully`);
                      
                      // Send video result
                      res.write(`data: ${JSON.stringify({ 
                        type: 'video', 
                        provider: 'veo', 
                        url: videoUrl,
                        model: currentModel.name,
                        index: i
                      })}\n\n`);
                      
                      usedModel = currentModel;
                      usedKieAi = true; // Mark that we used kie.ai
                      operation = { done: true }; // Dummy operation to pass validation
                      break; // Success, exit fallback loop
                    } else {
                      // Use Google API for Veo 3, 3 Fast, and 2
                      videoParams.model = currentModel.id;
                      
                      // Apply model-specific image format for image-to-video mode
                      if (generationType === 'image-to-video' && referenceImageBase64 && referenceImageMimeType) {
                        console.log(`[Veo/Google] Using ${currentModel.name} image-to-video format`);
                        videoParams.prompt = fullPrompt;
                        videoParams.image = {
                          imageBytes: referenceImageBase64,
                          mimeType: referenceImageMimeType
                        };
                        delete videoParams.source;
                      } else {
                        videoParams.prompt = fullPrompt;
                        delete videoParams.source;
                        delete videoParams.image;
                      }
                      
                      operation = await ai.models.generateVideos(videoParams);
                      usedModel = currentModel;
                      console.log(`[Veo/Google] Successfully started with ${currentModel.name}`);
                      res.write(`data: ${JSON.stringify({ 
                        type: 'status', 
                        provider: 'veo', 
                        message: `Generating with ${currentModel.name}...`,
                        model: currentModel.name
                      })}\n\n`);
                      break; // Success, exit fallback loop
                    }
                  } catch (modelError: any) {
                    console.log(`[Veo] ${currentModel.name} error:`, modelError.message || modelError);
                    
                    // Check if it's a rate limit error
                    const isRateLimit = modelError?.status === 429 || 
                                        modelError?.code === 429 ||
                                        modelError?.message?.toLowerCase().includes('rate limit') || 
                                        modelError?.message?.toLowerCase().includes('quota') ||
                                        modelError?.message?.toLowerCase().includes('resource_exhausted') ||
                                        modelError?.message?.toLowerCase().includes('insufficient credits');
                    
                    if (isRateLimit && modelIdx < fallbackModels.length - 1) {
                      console.log(`[Veo] ${currentModel.name} rate limit hit, trying next fallback...`);
                      res.write(`data: ${JSON.stringify({ 
                        type: 'status', 
                        provider: 'veo', 
                        message: `${currentModel.name} unavailable, trying fallback...`,
                        model: currentModel.name
                      })}\n\n`);
                      continue; // Try next model
                    } else {
                      throw modelError;
                    }
                  }
                }
                
                if (!operation) {
                  throw new Error('All Veo models exhausted (rate limits on all models)');
                }

                // Skip polling if we used kie.ai (already got the video)
                if (!usedKieAi) {
                  // Poll Google API until completion
                  let attempts = 0;
                  const maxAttempts = 60; // 10 minutes max
                  
                  while (!operation.done && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
                    operation = await ai.operations.getVideosOperation({ operation });
                    attempts++;
                  }

                  if (!operation.done) {
                    throw new Error('Video generation timed out after 10 minutes');
                  }

                  console.log('[Veo/Google] Operation completed. Checking response structure...');
                  console.log('[Veo/Google] operation.response:', operation.response);
                  console.log('[Veo/Google] operation.error:', (operation as any).error);
                  
                  // Check if operation completed with an error
                  if ((operation as any).error) {
                    const errorMsg = JSON.stringify((operation as any).error, null, 2);
                    console.error('[Veo/Google] Operation completed with error:', errorMsg);
                    throw new Error(`Veo generation failed: ${errorMsg}`);
                  }

                  // Get the generated video - check multiple possible response structures
                  const generatedVideo = operation.response?.generatedVideos?.[0];
                  
                  if (!generatedVideo) {
                    console.error('[Veo/Google] No generated video found. Available keys:', Object.keys(operation));
                    console.error('[Veo/Google] Full operation object:', JSON.stringify(operation, null, 2));
                    throw new Error('No video returned from Veo API');
                  }
                  
                  if (!generatedVideo.video) {
                    console.error('[Veo/Google] Generated video object:', JSON.stringify(generatedVideo, null, 2));
                    throw new Error('No video data in Veo API response');
                  }

                  // Get video URI from the response
                  const videoUri = generatedVideo.video.uri;
                  if (!videoUri) {
                    throw new Error('No video URI returned from Veo API');
                  }

                  // Download the video from Google's servers with authentication
                  const videoResponse = await fetch(videoUri, {
                    headers: {
                      'x-goog-api-key': process.env.GEMINI_API_KEY || ''
                    }
                  });

                  if (!videoResponse.ok) {
                    throw new Error(`Failed to download Veo video: ${videoResponse.statusText}`);
                  }

                  // Convert to base64 for client display
                  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
                  const videoBase64 = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;

                  // Stream this video result immediately with model info
                  res.write(`data: ${JSON.stringify({ 
                    type: 'video', 
                    provider: 'veo', 
                    url: videoBase64,
                    index: i,
                    model: usedModel.name
                  })}\n\n`);
                }
                // Note: kie.ai videos were already sent in the generation loop above
              } catch (error: any) {
                console.error(`Veo video ${i + 1} error:`, error);
                res.write(`data: ${JSON.stringify({ 
                  type: 'error', 
                  provider: 'veo', 
                  error: error.message,
                  index: i
                })}\n\n`);
              }
            }
            
            res.write(`data: ${JSON.stringify({ type: 'complete', provider: 'veo' })}\n\n`);
          } catch (error: any) {
            console.error("Veo generation error:", error);
            res.write(`data: ${JSON.stringify({ type: 'error', provider: 'veo', error: error.message })}\n\n`);
          }
        })()
      ]).then(() => {
        // All providers complete - send done event and flush
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.write('\n'); // Ensure final flush
        res.end();
      }).catch((error) => {
        console.error("Unexpected error in video generation:", error);
        res.write(`data: ${JSON.stringify({ type: 'error', provider: 'system', error: error.message })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.write('\n'); // Ensure final flush
        res.end();
      });
    } catch (error: any) {
      console.error("Error in streaming video generation:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', provider: 'system', error: error.message })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.write('\n'); // Ensure final flush
      res.end();
    }
  });

  // Generate videos using Sora 2 and Veo 3 Fast
  app.post("/api/generate-videos", upload.single('referenceImage'), async (req, res) => {
    try {
      const { productId, promptDetails, generationType, duration, amount, aspectRatio } = req.body;
      const referenceImage = req.file as Express.Multer.File | undefined;
      
      // Validate and parse amount with bounds checking
      let videoAmount = 1; // default
      if (amount !== undefined && amount !== null) {
        const parsedAmount = parseInt(amount);
        if (isNaN(parsedAmount) || parsedAmount < 1) {
          return res.status(400).json({
            success: false,
            error: "Amount must be a positive number (1, 2, or 4)"
          });
        }
        // Enforce maximum of 4 variations to prevent runaway costs
        if (parsedAmount > 4) {
          return res.status(400).json({
            success: false,
            error: "Amount cannot exceed 4 variations"
          });
        }
        videoAmount = parsedAmount;
      }
      
      // Validate and parse duration with bounds checking
      let videoDuration = 8; // default
      if (duration !== undefined && duration !== null) {
        const parsedDuration = parseInt(duration);
        if (isNaN(parsedDuration) || parsedDuration < 1) {
          return res.status(400).json({
            success: false,
            error: "Duration must be a positive number (4, 6, or 8 seconds)"
          });
        }
        // Enforce maximum of 8 seconds (can extend up to 90 for Sora, but start conservatively)
        if (parsedDuration > 8) {
          return res.status(400).json({
            success: false,
            error: "Duration cannot exceed 8 seconds"
          });
        }
        videoDuration = parsedDuration;
      }
      
      // Validate required fields
      if (!promptDetails || typeof promptDetails !== 'string' || promptDetails.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "Prompt details are required and must be a non-empty string"
        });
      }

      if (!generationType || !['text-to-video', 'image-to-video'].includes(generationType)) {
        return res.status(400).json({
          success: false,
          error: "Valid generation type required (text-to-video or image-to-video)"
        });
      }
      
      // Validate aspect ratio if provided
      if (aspectRatio && !['16:9', '9:16', '1:1'].includes(aspectRatio)) {
        return res.status(400).json({
          success: false,
          error: "Aspect ratio must be one of: 16:9, 9:16, 1:1"
        });
      }

      // Get product details if provided
      let productContext = "";
      if (productId && productId !== "none") {
        const product = await storage.getProduct(productId);
        if (product) {
          productContext = `Product: ${product.displayName || product.name}\nOffer Type: ${product.offerType}\n\n${product.manualContent}`;
        }
      }

      // Build full prompt with context
      const fullPrompt = productContext 
        ? `${productContext}\n\nVideo Concept: ${promptDetails}`
        : promptDetails;

      // Save reference image to disk and generate public URL if provided
      let referenceImageUrl: string | null = null;
      let referenceImageBase64: string | null = null;
      let referenceImageMimeType: string | null = null;
      if (referenceImage) {
        const fs = await import('fs');
        const path = await import('path');
        
        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        // Generate unique filename
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(7);
        const ext = path.extname(referenceImage.originalname);
        const filename = `ref-${timestamp}-${randomStr}${ext}`;
        const filepath = path.join(uploadsDir, filename);
        
        // Save file to disk
        fs.writeFileSync(filepath, referenceImage.buffer);
        
        // Generate public URL
        const host = req.get('host') || 'localhost:5000';
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'http');
        referenceImageUrl = `${protocol}://${host}/uploads/${filename}`;
        
        // Also store base64 for Veo (which uses base64)
        const base64 = referenceImage.buffer.toString('base64');
        referenceImageBase64 = base64;
        referenceImageMimeType = referenceImage.mimetype;
        
        console.log('[Video Gen] Saved reference image to:', filepath);
        console.log('[Video Gen] Public URL:', referenceImageUrl);
      }

      // Generate videos in parallel from both Sora 2 (kie.ai) and Veo 3 Fast
      const [soraResult, veoResult] = await Promise.all([
        // Sora 2 generation (kie.ai)
        (async () => {
          try {
            const soraVideos: Array<{ url: string; provider: 'sora' }> = [];
            const kieApiKey = process.env.SORA_VERIFIED_KEY;
            
            if (!kieApiKey) {
              throw new Error('SORA_VERIFIED_KEY not configured');
            }
            
            // Create video generation requests based on amount
            for (let i = 0; i < videoAmount; i++) {
              try {
                // Determine model based on generation type
                const model = (generationType === 'image-to-video' && referenceImageUrl)
                  ? 'sora-2-image-to-video'
                  : 'sora-2-text-to-video';

                // Convert aspect ratio to portrait/landscape format
                const aspectRatioFormat = aspectRatio === '9:16' ? 'portrait' : 'landscape';
                
                // Convert duration (seconds) to n_frames ("10" or "15")
                const nFrames = videoDuration >= 15 ? "15" : "10";

                // Build kie.ai task parameters with input object
                const taskParams: any = {
                  model,
                  input: {
                    prompt: fullPrompt,
                    aspect_ratio: aspectRatioFormat,
                    n_frames: nFrames,
                    remove_watermark: true
                  }
                };

                // Add image URL for image-to-video mode
                if (model === 'sora-2-image-to-video' && referenceImageUrl) {
                  taskParams.input.image_urls = [referenceImageUrl];
                }

                // Create task via kie.ai API
                console.log('[Sora/kie.ai] Creating task with params:', JSON.stringify(taskParams, null, 2));
                const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${kieApiKey}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(taskParams)
                });

                console.log('[Sora/kie.ai] createTask response status:', createResponse.status);
                
                if (!createResponse.ok) {
                  const errorText = await createResponse.text();
                  console.error('[Sora/kie.ai] createTask failed:', errorText);
                  throw new Error(`kie.ai createTask failed: ${createResponse.status} ${errorText}`);
                }

                const createResult = await createResponse.json();
                console.log('[Sora/kie.ai] createTask result:', JSON.stringify(createResult, null, 2));
                
                // Extract taskId from response (nested in data object)
                const taskId = createResult.data?.taskId || createResult.data?.task_id || 
                               createResult.taskId || createResult.task_id || createResult.id;

                if (!taskId) {
                  console.error('[Sora/kie.ai] No taskId in response. Full response:', createResult);
                  throw new Error('No taskId returned from kie.ai');
                }
                
                console.log('[Sora/kie.ai] Got taskId:', taskId);

                // Poll for completion using jobs/recordInfo endpoint
                let attempts = 0;
                const maxAttempts = 60; // 10 minutes max
                let taskComplete = false;
                let videoUrl = null;
                
                while (!taskComplete && attempts < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
                  
                  // Try GET request with taskId as query parameter
                  const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${kieApiKey}`,
                      'Content-Type': 'application/json'
                    }
                  });

                  console.log('[Sora/kie.ai] Status check HTTP status:', statusResponse.status);

                  if (!statusResponse.ok) {
                    const errorText = await statusResponse.text();
                    console.error('[Sora/kie.ai] Status check failed:', statusResponse.status, errorText);
                    throw new Error(`kie.ai status check failed: ${statusResponse.status} - ${errorText}`);
                  }

                  const statusResult = await statusResponse.json();
                  console.log('[Sora/kie.ai] Status check response:', JSON.stringify(statusResult, null, 2));
                  
                  // Extract status from nested data object if present
                  const data = statusResult.data || statusResult;
                  const status = data.state || data.status; // kie.ai uses "state" not "status"
                  
                  console.log('[Sora/kie.ai] Task status:', status);
                  
                  if (status === 'completed' || status === 'success' || status === 'SUCCESS') {
                    taskComplete = true;
                    
                    // Try to extract video URL from resultJson (if present) or other fields
                    if (data.resultJson) {
                      try {
                        const result = JSON.parse(data.resultJson);
                        // Use resultUrls (without watermark) if available, otherwise resultWaterMarkUrls
                        videoUrl = result.resultUrls?.[0] || result.resultWaterMarkUrls?.[0];
                      } catch (e) {
                        console.error('[Sora/kie.ai] Failed to parse resultJson:', e);
                      }
                    }
                    
                    // Fallback to other possible URL fields
                    if (!videoUrl) {
                      videoUrl = data.output?.video_url || data.videoUrl || data.url || data.video_url;
                    }
                  } else if (status === 'failed' || status === 'error' || status === 'FAILED') {
                    throw new Error(`Video generation failed: ${data.errorMessage || data.message || statusResult.msg || 'Unknown error'}`);
                  }
                  
                  attempts++;
                }

                if (!taskComplete) {
                  throw new Error('Sora video generation timed out after 10 minutes');
                }

                if (videoUrl) {
                  // Download video and convert to base64
                  const videoResponse = await fetch(videoUrl);
                  if (!videoResponse.ok) {
                    throw new Error(`Failed to download video: ${videoResponse.statusText}`);
                  }
                  
                  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
                  const videoBase64 = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;
                  
                  soraVideos.push({ url: videoBase64, provider: 'sora' });
                }
              } catch (error: any) {
                console.error(`Sora video ${i + 1} error:`, error);
                throw error;
              }
            }

            return { videos: soraVideos, provider: 'sora', error: null };
          } catch (error: any) {
            console.error("Sora generation error:", error);
            return { 
              videos: [], 
              provider: 'sora', 
              error: error?.message || 'Sora generation failed' 
            };
          }
        })(),

        // Veo 3.1 generation (Google Gemini)
        (async () => {
          try {
            const veoVideos: Array<{ url: string; provider: 'veo' }> = [];
            
            // Use Google GenAI SDK for Veo video generation
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

            // Create video generation requests based on amount
            for (let i = 0; i < videoAmount; i++) {
              try {
                const configParams: any = {};

                // Add aspect ratio if specified
                if (aspectRatio) {
                  configParams.aspectRatio = aspectRatio;
                }

                // Prepare video generation parameters with Veo 3 Fast first, fallback to Veo 2 on rate limit
                let videoParams: any = {
                  model: 'veo-3.0-fast-generate-preview',
                  prompt: fullPrompt,
                  config: configParams
                };

                // Add image for image-to-video mode (Veo 3 Fast supports this!)
                // Use the 'image' parameter (not 'referenceImages') for single image input
                if (generationType === 'image-to-video' && referenceImageBase64 && referenceImageMimeType) {
                  videoParams.image = {
                    imageBytes: referenceImageBase64,
                    mimeType: referenceImageMimeType
                  };
                }

                // Start video generation with fallback logic
                let operation;
                
                try {
                  // Try Veo 3 Fast first
                  console.log(`[Veo] Attempting with Veo 3 Fast (${i + 1}/${videoAmount})`);
                  operation = await ai.models.generateVideos(videoParams);
                } catch (veo3Error: any) {
                  // Check if it's a rate limit error
                  const isRateLimitError = 
                    veo3Error?.status === 429 || 
                    veo3Error?.message?.toLowerCase().includes('rate limit') ||
                    veo3Error?.message?.toLowerCase().includes('quota') ||
                    veo3Error?.message?.toLowerCase().includes('resource_exhausted');
                  
                  if (isRateLimitError) {
                    console.log(`[Veo] Veo 3 Fast rate limit hit, falling back to Veo 2 (${i + 1}/${videoAmount})`);
                    
                    // Fallback to Veo 2
                    videoParams.model = 'veo-2.0-generate-001';
                    operation = await ai.models.generateVideos(videoParams);
                  } else {
                    // If not a rate limit error, re-throw
                    throw veo3Error;
                  }
                }

                // Poll until completion
                let attempts = 0;
                const maxAttempts = 60; // 10 minutes max
                
                while (!operation.done && attempts < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
                  operation = await ai.operations.getVideosOperation({ operation });
                  attempts++;
                }

                if (!operation.done) {
                  throw new Error('Video generation timed out after 10 minutes');
                }

                console.log('[Veo] Operation completed. Checking response structure...');
                console.log('[Veo] operation.response:', operation.response);
                console.log('[Veo] operation.error:', (operation as any).error);
                
                // Check if operation completed with an error
                if ((operation as any).error) {
                  const errorMsg = JSON.stringify((operation as any).error, null, 2);
                  console.error('[Veo] Operation completed with error:', errorMsg);
                  throw new Error(`Veo generation failed: ${errorMsg}`);
                }

                // Get the generated video - check multiple possible response structures
                const generatedVideo = operation.response?.generatedVideos?.[0];
                
                if (!generatedVideo) {
                  console.error('[Veo] No generated video found. Available keys:', Object.keys(operation));
                  console.error('[Veo] Full operation object:', JSON.stringify(operation, null, 2));
                  throw new Error('No video returned from Veo API');
                }
                
                if (!generatedVideo.video) {
                  console.error('[Veo] Generated video object:', JSON.stringify(generatedVideo, null, 2));
                  throw new Error('No video data in Veo API response');
                }

                // Get video URI from the response
                const videoUri = generatedVideo.video.uri;
                if (!videoUri) {
                  throw new Error('No video URI returned from Veo API');
                }

                // Download the video from Google's servers with authentication
                const videoResponse = await fetch(videoUri, {
                  headers: {
                    'x-goog-api-key': process.env.GEMINI_API_KEY || ''
                  }
                });

                if (!videoResponse.ok) {
                  throw new Error(`Failed to download Veo video: ${videoResponse.statusText}`);
                }

                // Convert to base64 for client display
                const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
                const videoBase64 = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;

                veoVideos.push({ url: videoBase64, provider: 'veo' });
              } catch (error: any) {
                console.error(`Veo video ${i + 1} error:`, error);
                throw error;
              }
            }

            return { videos: veoVideos, provider: 'veo', error: null };
          } catch (error: any) {
            console.error("Veo generation error:", error);
            return { 
              videos: [], 
              provider: 'veo', 
              error: error?.message || 'Veo generation failed' 
            };
          }
        })()
      ]);

      res.json({
        success: true,
        soraVideos: soraResult.videos,
        veoVideos: veoResult.videos,
        errors: {
          sora: soraResult.error,
          veo: veoResult.error
        }
      });
    } catch (error: any) {
      console.error("Error generating videos:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to generate videos"
      });
    }
  });

  // Save video to library
  app.post("/api/videos/save", async (req, res) => {
    try {
      const { url, productId, provider, prompt, generationType, duration, aspectRatio, referenceImageUrls } = req.body;

      if (!url || !provider || !prompt || !generationType || !duration) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: url, provider, prompt, generationType, duration"
        });
      }

      const savedVideo = await storage.createSavedVideo({
        url,
        productId: productId === "none" ? null : productId,
        provider,
        prompt,
        generationType,
        duration,
        aspectRatio: aspectRatio || null,
        referenceImageUrls: referenceImageUrls || null,
      });

      res.json({ success: true, video: savedVideo });
    } catch (error: any) {
      console.error("Error saving video:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to save video"
      });
    }
  });

  app.get("/api/videos", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 12;
      const productId = req.query.productId as string | undefined;

      const { videos, total } = await storage.getSavedVideosPaginated({ page, limit, productId });
      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        videos,
        total,
        page,
        totalPages,
        limit,
      });
    } catch (error: any) {
      console.error("Error fetching videos:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch videos"
      });
    }
  });

  // Get saved videos by session (for background generation recovery)
  app.get("/api/videos/session/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const videos = await storage.getSavedVideosBySession(sessionId);
      res.json({ success: true, videos });
    } catch (error: any) {
      console.error("Error fetching videos by session:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch videos"
      });
    }
  });

  // Delete a saved video
  app.delete("/api/videos/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteSavedVideo(id);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: "Video not found"
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting video:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to delete video"
      });
    }
  });

  // Multi-model video generation with SSE
  app.post("/api/generate-videos-multi", upload.fields([
    { name: 'referenceImages', maxCount: 3 },
    { name: 'referenceVideo', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const { 
        productId, 
        promptDetails, 
        generationType, 
        duration, 
        amount, 
        aspectRatio,
        selectedModels,
        sessionId 
      } = req.body;
      
      console.log("[Video Gen] Received sessionId:", sessionId);
      
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const referenceImages = files?.referenceImages || [];
      const referenceVideo = files?.referenceVideo?.[0];
      
      console.log("[Video Gen] Received", referenceImages.length, "reference images");
      referenceImages.forEach((img, i) => {
        console.log(`[Video Gen] Image ${i}: ${img.originalname}, size: ${img.size}, type: ${img.mimetype}`);
      });
      
      // Set headers for SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      
      // Send initial status
      res.write(`data: ${JSON.stringify({ type: 'status', message: 'Starting video generation...' })}\n\n`);
      
      // Parse and validate selectedModels
      let modelIds: string[] = [];
      try {
        modelIds = JSON.parse(selectedModels);
        if (!Array.isArray(modelIds) || modelIds.length === 0) {
          throw new Error('At least one model must be selected');
        }
      } catch (error) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Invalid selectedModels format' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        return;
      }
      
      // Validate and parse amount
      const videoAmount = parseInt(amount) || 1;
      if (videoAmount < 1 || videoAmount > 4) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Amount must be between 1 and 4' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        return;
      }
      
      // Validate and parse duration (allow 4-25 seconds to support all models including Kling 5-10s and Sora up to 25s)
      const videoDuration = parseInt(duration) || 6;
      if (videoDuration < 4 || videoDuration > 25) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Duration must be between 4 and 25 seconds' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        return;
      }
      
      // Validate prompt
      if (!promptDetails || typeof promptDetails !== 'string' || promptDetails.trim().length === 0) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Prompt details are required' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        return;
      }
      
      // Get product context if provided
      let productContext = "";
      if (productId && productId !== "none") {
        const product = await storage.getProduct(productId);
        if (product) {
          productContext = `Product: ${product.displayName || product.name}\nOffer Type: ${product.offerType}\n\n${product.manualContent}`;
        }
      }
      
      const fullPrompt = productContext 
        ? `${productContext}\n\nVideo Concept: ${promptDetails}`
        : promptDetails;
      
      // Process reference media files
      const fs = await import('fs');
      const path = await import('path');
      
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      // Save reference images and generate URLs
      const referenceImageUrls: string[] = [];
      const referenceImageBase64s: string[] = [];
      
      for (const imgFile of referenceImages) {
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(7);
        const ext = path.extname(imgFile.originalname);
        const filename = `ref-${timestamp}-${randomStr}${ext}`;
        const filepath = path.join(uploadsDir, filename);
        
        fs.writeFileSync(filepath, imgFile.buffer);
        
        const host = req.get('host') || 'localhost:5000';
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'http');
        const imageUrl = `${protocol}://${host}/uploads/${filename}`;
        
        referenceImageUrls.push(imageUrl);
        referenceImageBase64s.push(imgFile.buffer.toString('base64'));
      }
      
      // Save reference video if provided
      let referenceVideoUrl: string | null = null;
      if (referenceVideo) {
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(7);
        const ext = path.extname(referenceVideo.originalname);
        const filename = `ref-video-${timestamp}-${randomStr}${ext}`;
        const filepath = path.join(uploadsDir, filename);
        
        fs.writeFileSync(filepath, referenceVideo.buffer);
        
        const host = req.get('host') || 'localhost:5000';
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'http');
        referenceVideoUrl = `${protocol}://${host}/uploads/${filename}`;
      }
      
      console.log(`[Multi-Model] Received ${modelIds.length} model IDs:`, modelIds);
      
      res.write(`data: ${JSON.stringify({ 
        type: 'status', 
        message: `Generating with ${modelIds.length} model(s)...` 
      })}\n\n`);
      
      // Generate videos for each selected model with staggered start
      const generationPromises = modelIds.map(async (modelId, index) => {
        // Add staggered delay (2 seconds per model) to prevent API rate limiting
        if (index > 0) {
          const delayMs = index * 2000;
          console.log(`[Multi-Model] Delaying ${modelId} by ${delayMs}ms to stagger requests`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        console.log(`[Multi-Model] Processing model: ${modelId}`);
        
        const model = VIDEO_MODELS[modelId];
        if (!model) {
          console.error(`[Multi-Model] Unknown model: ${modelId}`);
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            modelId, 
            modelName: modelId,
            error: 'Unknown model' 
          })}\n\n`);
          return;
        }
        
        console.log(`[Multi-Model] Starting generation for ${model.name} (provider: ${model.provider})`);
        
        try {
          res.write(`data: ${JSON.stringify({ 
            type: 'status', 
            modelId,
            modelName: model.name,
            message: `Starting ${model.name} generation...` 
          })}\n\n`);
          
          // Route to appropriate generation function based on model provider
          if (modelId === 'sora-2' || modelId === 'sora-2-pro') {
            console.log(`[Multi-Model] Routing to Sora generation for ${modelId}`);
            // Sora 2 / Sora 2 Pro via kie.ai
            await generateSoraVideo(
              res, modelId, model.name, fullPrompt, videoAmount, videoDuration, 
              aspectRatio, generationType, referenceImageUrls[0],
              sessionId, productId, promptDetails, referenceImageUrls
            );
            console.log(`[Multi-Model] Completed Sora generation for ${modelId}`);
          } else if (modelId.startsWith('veo-')) {
            console.log(`[Multi-Model] Routing to Veo generation for ${modelId} (provider: ${model.provider})`);
            
            // Veo only supports 16:9 and 9:16 aspect ratios (no 1:1 support)
            if (aspectRatio === '1:1') {
              console.log(`[Multi-Model] Skipping ${modelId} - Veo doesn't support 1:1 aspect ratio`);
              res.write(`data: ${JSON.stringify({ 
                type: 'error', 
                modelId,
                modelName: model.name,
                error: 'Veo models only support 16:9 and 9:16 aspect ratios. Please use Sora for 1:1 square videos.' 
              })}\n\n`);
              return;
            }
            
            // Veo models (various versions via Google or kie.ai)
            await generateVeoVideo(
              res, modelId, model.name, fullPrompt, videoAmount, videoDuration,
              aspectRatio, generationType, referenceImageBase64s[0], referenceImageUrls[0],
              sessionId, productId, promptDetails, referenceImageUrls
            );
            console.log(`[Multi-Model] Completed Veo generation for ${modelId}`);
          } else if (modelId.startsWith('kling-')) {
            console.log(`[Multi-Model] Routing to Kling generation for ${modelId}`);
            
            // Kling models via kie.ai
            await generateKlingVideo(
              res, modelId, model.name, fullPrompt, videoAmount, videoDuration,
              aspectRatio, generationType, referenceImageUrls[0]
            );
            console.log(`[Multi-Model] Completed Kling generation for ${modelId}`);
          }
          
        } catch (error: any) {
          // Check for 429 rate limit error
          if (error.message?.includes('429') || error.message?.toLowerCase().includes('rate limit')) {
            console.log(`[Rate Limit] ${model.name} hit rate limit, marking as capped`);
            
            // Mark model as capped until 3:00 AM EST
            await storage.markModelCapped(modelId);
            
            res.write(`data: ${JSON.stringify({ 
              type: 'rate_limit', 
              modelId,
              modelName: model.name,
              error: 'Rate limit reached - model will be unavailable until 3:00 AM EST' 
            })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ 
              type: 'error', 
              modelId,
              modelName: model.name,
              error: error.message || 'Generation failed' 
            })}\n\n`);
          }
        }
      });
      
      // Wait for all models to complete
      await Promise.all(generationPromises);
      
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      
    } catch (error: any) {
      console.error("Error in multi-model video generation:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || 'Generation failed' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }
  });
  
  // Helper function for Sora 2 generation via kie.ai
  async function generateSoraVideo(
    res: any,
    modelId: string,
    modelName: string,
    prompt: string,
    amount: number,
    duration: number,
    aspectRatio: string,
    generationType: string,
    referenceImageUrl?: string,
    sessionId?: string,
    productId?: string,
    originalPrompt?: string,
    referenceImageUrls?: string[]
  ) {
    const kieApiKey = process.env.SORA_VERIFIED_KEY;
    if (!kieApiKey) {
      throw new Error('SORA_VERIFIED_KEY not configured');
    }
    
    for (let i = 0; i < amount; i++) {
      try {
        // Determine the correct model name based on modelId and generation type
        const isPro = modelId === 'sora-2-pro';
        const baseModelName = isPro ? 'sora-2-pro' : 'sora-2';
        
        const model = generationType === 'image-to-video' && referenceImageUrl
          ? `${baseModelName}-image-to-video`
          : `${baseModelName}-text-to-video`;
        
        const aspectRatioFormat = aspectRatio === '9:16' ? 'portrait' : 'landscape';
        const nFrames = duration >= 7 ? "15" : "10";
        
        // Build input parameters
        const inputParams: any = {
          prompt,
          aspect_ratio: aspectRatioFormat,
          n_frames: nFrames,
          remove_watermark: true
        };
        
        // Add size parameter for Pro models
        if (isPro) {
          inputParams.size = 'standard'; // Can be 'standard' or 'high'
        }
        
        // Add image URLs for image-to-video
        if (model.includes('image-to-video') && referenceImageUrl) {
          inputParams.image_urls = [referenceImageUrl];
        }
        
        // Build complete request body with model and input
        const taskParams = {
          model,
          input: inputParams
        };
        
        console.log(`[Sora/kie.ai] Creating task with model: ${model}`);
        console.log(`[Sora/kie.ai] Task params:`, JSON.stringify(taskParams, null, 2));
        
        // Use the /api/v1/jobs/createTask endpoint as per documentation
        const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${kieApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(taskParams)
        });
        
        console.log(`[Sora/kie.ai] Response status: ${createResponse.status}`);
        
        if (createResponse.status === 429) {
          throw new Error('429 Rate limit exceeded');
        }
        
        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          console.error(`[Sora/kie.ai] API call failed:`, errorText);
          throw new Error(`kie.ai Sora API failed: ${createResponse.status} - ${errorText}`);
        }
        
        const createResult = await createResponse.json();
        console.log(`[Sora/kie.ai] Response data:`, JSON.stringify(createResult));
        
        // Extract task ID from response
        const taskId = createResult.data?.taskId || createResult.taskId;
        
        if (!taskId) {
          console.error(`[Sora/kie.ai] No taskId in response:`, createResult);
          throw new Error('No taskId returned from kie.ai Sora API');
        }
        
        console.log(`[Sora/kie.ai] Task created with ID: ${taskId}`);
        
        // Poll for completion using Sora-specific endpoint
        let attempts = 0;
        const maxAttempts = 60;
        let videoUrl = null;
        
        console.log(`[Sora/kie.ai] Starting to poll task: ${taskId} (max ${maxAttempts} attempts)`);
        
        while (!videoUrl && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          attempts++;
          
          console.log(`[Sora/kie.ai] Poll attempt ${attempts}/${maxAttempts} for task ${taskId}`);
          
          // Use the correct polling endpoint for jobs
          const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${kieApiKey}`
            }
          });
          
          console.log(`[Sora/kie.ai] Poll response status: ${statusResponse.status}`);
          
          if (!statusResponse.ok) {
            const errorText = await statusResponse.text();
            console.error(`[Sora/kie.ai] Status check failed:`, errorText);
            // Don't throw immediately, might be still processing
            continue;
          }
          
          const statusResult = await statusResponse.json();
          console.log(`[Sora/kie.ai] Poll response:`, JSON.stringify(statusResult));
          
          // Parse response: { code, message, data: { taskId, model, state, resultUrls, ... } }
          const data = statusResult.data;
          
          if (!data) {
            console.error(`[Sora/kie.ai] No data in response:`, statusResult);
            continue;
          }
          
          const state = data.state;
          console.log(`[Sora/kie.ai] Task state: ${state}`);
          
          if (state === 'success') {
            // Video generation completed successfully
            // Parse resultJson string to get resultUrls
            if (data.resultJson) {
              const resultData = JSON.parse(data.resultJson);
              if (resultData.resultUrls && resultData.resultUrls.length > 0) {
                videoUrl = resultData.resultUrls[0];
                console.log(`[Sora/kie.ai] Task completed successfully! Video URL: ${videoUrl}`);
                
                // Download and convert to base64
                const videoResponse = await fetch(videoUrl);
                const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
                const videoBase64 = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;
                
                res.write(`data: ${JSON.stringify({ 
                  type: 'video',
                  modelId,
                  modelName,
                  url: videoBase64,
                  variationIndex: i
                })}\n\n`);
              } else {
                console.error(`[Sora/kie.ai] No resultUrls in parsed resultJson:`, resultData);
              }
            } else {
              console.error(`[Sora/kie.ai] No resultJson in successful response:`, data);
            }
          } else if (state === 'fail') {
            // Generation failed
            const errorMessage = data.failMsg || data.failReason || 'Generation failed';
            console.error(`[Sora/kie.ai] Task failed - reason: ${data.failReason}, message: ${data.failMsg}`);
            throw new Error(errorMessage);
          }
          // If state is 'waiting', 'pending', or 'generating', continue polling
        }
        
        if (!videoUrl) {
          throw new Error('Video generation timeout');
        }
        
      } catch (error) {
        throw error;
      }
    }
  }
  
  // Helper function for Veo generation
  async function generateVeoVideo(
    res: any,
    modelId: string,
    modelName: string,
    prompt: string,
    amount: number,
    duration: number,
    aspectRatio: string,
    generationType: string,
    referenceImageBase64?: string,
    referenceImageUrl?: string,
    sessionId?: string,
    productId?: string,
    originalPrompt?: string,
    referenceImageUrls?: string[]
  ) {
    const model = VIDEO_MODELS[modelId];
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    
    // Route to appropriate provider
    if (model.provider === 'kie') {
      // Veo 3.1, Veo 3.1 Fast, Veo 3, Veo 3 Fast via kie.ai
      await generateVeoVideoViaKieAi(res, modelId, modelName, prompt, amount, aspectRatio, generationType, referenceImageUrl);
    } else if (model.provider === 'google') {
      // Veo 2 via Google Gemini API
      await generateVeoVideoViaGemini(res, modelId, modelName, prompt, amount, aspectRatio, generationType, referenceImageBase64, referenceImageUrl);
    } else {
      throw new Error(`Unsupported provider for ${modelName}: ${model.provider}`);
    }
  }
  
  // Veo generation via kie.ai (Veo 3.1, Veo 3.1 Fast, Veo 3, Veo 3 Fast)
  async function generateVeoVideoViaKieAi(
    res: any,
    modelId: string,
    modelName: string,
    prompt: string,
    amount: number,
    aspectRatio: string,
    generationType: string,
    referenceImageUrl?: string
  ) {
    // Map model ID to kie.ai model name
    // veo-3.1 and veo-3 both map to 'veo3'
    // veo-3.1-fast and veo-3-fast both map to 'veo3_fast'
    const kieModel = (modelId === 'veo-3.1-fast' || modelId === 'veo-3-fast') ? 'veo3_fast' : 'veo3';
    
    // Map generation type to kie.ai format
    let kieGenType: 'TEXT_2_VIDEO' | 'FIRST_AND_LAST_FRAMES_2_VIDEO' | 'REFERENCE_2_VIDEO' = 'TEXT_2_VIDEO';
    if (generationType === 'image-to-video' || generationType === 'first-last-frames') {
      kieGenType = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
    } else if (generationType === 'reference-images') {
      kieGenType = 'REFERENCE_2_VIDEO';
    }
    
    for (let i = 0; i < amount; i++) {
      try {
        // Create generation task
        const { taskId } = await generateVeoVideoWithKieAi({
          prompt,
          model: kieModel,
          generationType: kieGenType,
          imageUrls: referenceImageUrl ? [referenceImageUrl] : undefined,
          aspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9'
        });
        
        // Poll for completion
        const videoUrl = await pollKieAiVeoTask(taskId);
        
        // Download video
        const videoResponse = await fetch(videoUrl);
        if (!videoResponse.ok) {
          throw new Error(`Failed to download video: ${videoResponse.status}`);
        }
        
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        const videoBase64 = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;
        
        // Send video via SSE
        res.write(`data: ${JSON.stringify({ 
          type: 'video',
          modelId,
          modelName,
          url: videoBase64,
          variationIndex: i
        })}\n\n`);
        
      } catch (error: any) {
        if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota')) {
          throw new Error('429 Rate limit exceeded');
        }
        throw error;
      }
    }
  }
  
  // Veo generation via Google Gemini API (Veo 3, Veo 3 Fast, Veo 2)
  async function generateVeoVideoViaGemini(
    res: any,
    modelId: string,
    modelName: string,
    prompt: string,
    amount: number,
    aspectRatio: string,
    generationType: string,
    referenceImageBase64?: string,
    referenceImageUrl?: string
  ) {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Map model ID to Gemini model name
    let geminiModel = 'veo-2.0-generate-001'; // Default to Veo 2
    if (modelId === 'veo-3') {
      geminiModel = 'veo-3.0-generate-preview';
    } else if (modelId === 'veo-3-fast') {
      geminiModel = 'veo-3.0-fast-generate-preview';
    }
    
    for (let i = 0; i < amount; i++) {
      try {
        // Add delay between requests to respect Google's rate limit (2 requests/minute for Veo 2)
        // Wait 35 seconds between requests to stay under the limit
        if (i > 0) {
          console.log(`[Veo 2] Waiting 35 seconds before request ${i + 1}/${amount} to respect rate limit...`);
          res.write(`data: ${JSON.stringify({ 
            type: 'status',
            modelId,
            modelName,
            message: `Waiting to respect rate limit before generating variation ${i + 1}...`
          })}\n\n`);
          await new Promise(resolve => setTimeout(resolve, 35000)); // 35 second delay
        }
        
        const configParams: any = {};
        if (aspectRatio) {
          configParams.aspectRatio = aspectRatio;
        }
        
        const videoParams: any = {
          model: geminiModel,
          prompt,
          config: configParams
        };
        
        // Add image for image-to-video mode
        if (generationType === 'image-to-video' && referenceImageBase64) {
          videoParams.image = {
            imageBytes: referenceImageBase64,
            mimeType: 'image/jpeg'
          };
        }
        
        // Generate video
        let operation = await ai.models.generateVideos(videoParams);
        
        // Poll for completion
        let attempts = 0;
        const maxAttempts = 60; // 10 minutes max
        
        while (!operation.done && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
          operation = await ai.operations.getVideosOperation({ operation });
          attempts++;
        }
        
        if (!operation.done) {
          throw new Error('Video generation timed out after 10 minutes');
        }
        
        // Check for errors
        if ((operation as any).error) {
          const errorMsg = JSON.stringify((operation as any).error, null, 2);
          throw new Error(`Veo generation failed: ${errorMsg}`);
        }
        
        // Get the generated video
        const generatedVideo = operation.response?.generatedVideos?.[0];
        if (!generatedVideo || !generatedVideo.video) {
          throw new Error('No video returned from Veo API');
        }
        
        // Get video URI from the response
        const videoUri = generatedVideo.video.uri;
        if (!videoUri) {
          throw new Error('No video URI returned from Veo API');
        }
        
        console.log(`[Veo/Google] Downloading video from URI: ${videoUri}`);
        
        // Download the video from Google's servers with authentication
        const videoResponse = await fetch(videoUri, {
          headers: {
            'x-goog-api-key': process.env.GEMINI_API_KEY || ''
          }
        });
        
        console.log(`[Veo/Google] Video download response: ${videoResponse.status} ${videoResponse.statusText}`);
        console.log(`[Veo/Google] Content-Type: ${videoResponse.headers.get('content-type')}`);
        console.log(`[Veo/Google] Content-Length: ${videoResponse.headers.get('content-length')}`);
        
        if (!videoResponse.ok) {
          throw new Error(`Failed to download Veo video: ${videoResponse.statusText}`);
        }
        
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        console.log(`[Veo/Google] Downloaded video buffer size: ${videoBuffer.length} bytes`);
        
        const videoUrl = await saveVideoToFile(videoBuffer);
        console.log(`[Veo/Google] Saved video to: ${videoUrl}`);
        
        // Convert to base64 for frontend display
        const videoBase64 = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;
        console.log(`[Veo/Google] Converted video to base64 (${videoBase64.length} characters)`);
        
        res.write(`data: ${JSON.stringify({ 
          type: 'video',
          modelId,
          modelName,
          url: videoBase64,
          variationIndex: i
        })}\n\n`);
        
      } catch (error: any) {
        // Check for rate limit
        const isRateLimitError = 
          error?.status === 429 || 
          error?.message?.toLowerCase().includes('rate limit') ||
          error?.message?.toLowerCase().includes('quota') ||
          error?.message?.toLowerCase().includes('resource_exhausted');
        
        if (isRateLimitError) {
          throw new Error('429 Rate limit exceeded');
        }
        throw error;
      }
    }
  }

  // Kling 2.6 generation via kie.ai
  async function generateKlingVideo(
    res: any,
    modelId: string,
    modelName: string,
    prompt: string,
    amount: number,
    duration: number,
    aspectRatio: string,
    generationType: string,
    referenceImageUrl?: string
  ) {
    for (let i = 0; i < amount; i++) {
      try {
        // Create generation task
        const { taskId } = await generateKlingVideoWithKieAi({
          prompt,
          generationType: generationType === 'image-to-video' ? 'image-to-video' : 'text-to-video',
          imageUrl: referenceImageUrl,
          aspectRatio: aspectRatio as '16:9' | '9:16' | '1:1',
          duration: duration <= 5 ? '5' : '10'
        });
        
        // Poll for completion
        const videoUrl = await pollKieAiKlingTask(taskId);
        
        console.log(`[kie.ai/Kling] Video URL: ${videoUrl}`);
        
        // Send video URL directly via SSE (avoid large base64 which breaks SSE)
        console.log(`[kie.ai/Kling] Sending video URL via SSE...`);
        res.write(`data: ${JSON.stringify({ 
          type: 'video',
          modelId,
          modelName,
          url: videoUrl,
          variationIndex: i
        })}\n\n`);
        console.log(`[kie.ai/Kling] Video URL sent successfully for variation ${i}`);
        
      } catch (error: any) {
        if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota')) {
          throw new Error('429 Rate limit exceeded');
        }
        throw error;
      }
    }
  }

  // Helper function to create Kling 2.6 video generation task via kie.ai
  async function generateKlingVideoWithKieAi(params: {
    prompt: string;
    generationType: 'text-to-video' | 'image-to-video';
    imageUrl?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
    duration?: '5' | '10';
  }): Promise<{ taskId: string }> {
    console.log(`[kie.ai/Kling] Initiating Kling 2.6 ${params.generationType} generation`);
    
    const kieApiKey = process.env.SORA_VERIFIED_KEY;
    if (!kieApiKey) {
      throw new Error('kie.ai API key not configured');
    }

    // Build request body based on kie.ai documentation
    // API uses model field and input wrapper object
    const modelType = params.generationType === 'image-to-video' 
      ? 'kling-2.6/image-to-video' 
      : 'kling-2.6/text-to-video';
    
    // Build input object per API spec
    // Kling 2.6 has a 1000 character limit on prompts
    const truncatedPrompt = params.prompt.length > 1000 
      ? params.prompt.substring(0, 997) + '...'
      : params.prompt;
    
    if (params.prompt.length > 1000) {
      console.log(`[kie.ai/Kling] Prompt truncated from ${params.prompt.length} to 1000 characters`);
    }
    
    const input: any = {
      prompt: truncatedPrompt,
      sound: true, // Kling 2.6 supports native audio
      duration: params.duration || '5' // API expects string "5" or "10"
    };

    if (params.generationType === 'image-to-video') {
      if (!params.imageUrl) {
        throw new Error('Image URL required for image-to-video generation');
      }
      input.image_urls = [params.imageUrl]; // Array of URLs per docs
    }
    
    const requestBody: any = {
      model: modelType,
      input: input
    };
    
    console.log(`[kie.ai/Kling] Request body:`, JSON.stringify(requestBody, null, 2));

    // kie.ai endpoint per docs: /api/v1/jobs/createTask
    const endpoint = 'https://api.kie.ai/api/v1/jobs/createTask';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kieApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`[kie.ai/Kling] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[kie.ai/Kling] Error response:`, errorText);
      if (response.status === 429) {
        throw new Error('429 Rate limit exceeded');
      }
      throw new Error(`kie.ai Kling API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log(`[kie.ai/Kling] Response data:`, JSON.stringify(data, null, 2));
    
    if (data.code !== 200) {
      console.error(`[kie.ai/Kling] API returned error code: ${data.code}, message: ${data.msg}`);
      throw new Error(`kie.ai Kling error: ${data.msg || 'Unknown error'}`);
    }

    const taskId = data.data?.taskId || data.data?.task_id;
    if (!taskId) {
      throw new Error('No task ID returned from Kling API');
    }

    console.log(`[kie.ai/Kling] Task created with ID: ${taskId}`);
    return { taskId };
  }

  // Poll for Kling 2.6 task completion via kie.ai
  async function pollKieAiKlingTask(taskId: string, maxAttempts = 120): Promise<string> {
    console.log(`[kie.ai/Kling] Starting to poll task: ${taskId} (max ${maxAttempts} attempts)`);
    
    const kieApiKey = process.env.SORA_VERIFIED_KEY;
    if (!kieApiKey) {
      throw new Error('kie.ai API key not configured');
    }

    let videoUrl = '';
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
      attempts++;

      try {
        // kie.ai query task endpoint for playground/Kling
        const statusUrl = `https://api.kie.ai/api/v1/playground/recordInfo?taskId=${taskId}`;
        const statusResponse = await fetch(statusUrl, {
          headers: {
            'Authorization': `Bearer ${kieApiKey}`
          }
        });

        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          console.error(`[kie.ai/Kling] Status check error:`, errorText);
          if (statusResponse.status === 429) {
            throw new Error('429 Rate limit exceeded');
          }
          continue;
        }

        const statusData = await statusResponse.json();
        console.log(`[kie.ai/Kling] Poll attempt ${attempts}/${maxAttempts}, status:`, statusData.data?.state || 'unknown');

        if (statusData.code !== 200) {
          console.error(`[kie.ai/Kling] Status error: ${statusData.msg || statusData.message}`);
          continue;
        }

        const state = statusData.data?.state;
        
        if (state === 'success') {
          // Extract video URL from resultJson per kie.ai docs
          let resultUrl = '';
          
          // Try parsing resultJson if it's a string
          if (statusData.data?.resultJson) {
            try {
              const resultJson = typeof statusData.data.resultJson === 'string' 
                ? JSON.parse(statusData.data.resultJson) 
                : statusData.data.resultJson;
              resultUrl = resultJson.resultUrls?.[0] || resultJson.videoUrl || '';
            } catch (e) {
              console.error('[kie.ai/Kling] Failed to parse resultJson:', e);
            }
          }
          
          // Fallback to other possible fields
          if (!resultUrl) {
            resultUrl = statusData.data?.result_url || 
                       statusData.data?.resultUrl ||
                       statusData.data?.video_url ||
                       statusData.data?.videoUrl || '';
          }
          
          if (resultUrl) {
            videoUrl = resultUrl;
            console.log(`[kie.ai/Kling] Video generated successfully: ${videoUrl}`);
            break;
          }
        } else if (state === 'fail' || state === 'failed' || state === 'error') {
          const errorMessage = statusData.data?.failMsg || statusData.data?.error_message || 'Generation failed';
          console.error(`[kie.ai/Kling] Generation failed: ${errorMessage}`);
          throw new Error(errorMessage);
        }
        // If state is 'waiting', 'pending', or 'generating', continue polling
      } catch (error: any) {
        if (error.message?.includes('429')) {
          throw error;
        }
        console.error(`[kie.ai/Kling] Poll error:`, error.message);
      }
    }
    
    if (!videoUrl) {
      throw new Error('Kling video generation timeout');
    }
    
    return videoUrl;
  }

  // Storage routes for persisting generated videos and images
  // Reference: blueprint:javascript_object_storage (simplified for AI-generated content)
  const { uploadToStorage, downloadFromStorage } = await import('./objectStorage');
  
  // Upload endpoint - accepts base64 data and saves to storage
  app.post("/api/storage/upload", async (req, res) => {
    try {
      const { data, filename, contentType } = req.body;
      
      if (!data || !filename || !contentType) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      // Convert base64 to buffer
      const base64Data = data.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Upload to storage
      const storagePath = await uploadToStorage(buffer, filename, contentType);
      
      res.json({ success: true, storagePath });
    } catch (error: any) {
      console.error("Storage upload error:", error);
      res.status(500).json({ error: "Failed to upload to storage" });
    }
  });
  
  // Download endpoint - retrieves file from storage (supports HTTP Range for video streaming)
  app.get("/storage/:objectId", async (req, res) => {
    try {
      const { objectId } = req.params;
      const rangeHeader = req.headers.range;
      console.log(`[Storage Route] Request for ${objectId}, Range: ${rangeHeader || 'none'}`);
      await downloadFromStorage(objectId, res, rangeHeader);
    } catch (error: any) {
      console.error("[Storage Route] Error downloading from storage:", error);
      console.error("[Storage Route] Error stack:", error.stack);
      if (!res.headersSent) {
        res.status(500).send(`Storage error: ${error.message}`);
      }
    }
  });

  // Diagnostic endpoint to check if a file exists in storage
  app.get("/api/storage/check/:objectId", async (req, res) => {
    try {
      const { objectId } = req.params;
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || "";
      
      if (!privateObjectDir) {
        return res.json({
          exists: false,
          error: "PRIVATE_OBJECT_DIR not set",
          objectId
        });
      }

      const { objectStorageClient } = await import('./objectStorage');
      const fullPath = `${privateObjectDir}/generated/${objectId}`;
      const pathParts = fullPath.split("/");
      const bucketName = pathParts[1];
      const objectName = pathParts.slice(2).join("/");
      
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      
      if (exists) {
        const [metadata] = await file.getMetadata();
        res.json({
          exists: true,
          objectId,
          fullPath,
          bucketName,
          objectName,
          size: metadata.size,
          contentType: metadata.contentType
        });
      } else {
        res.json({
          exists: false,
          objectId,
          fullPath,
          bucketName,
          objectName
        });
      }
    } catch (error: any) {
      res.status(500).json({
        exists: false,
        error: error.message,
        objectId: req.params.objectId
      });
    }
  });

  // GIF Conversion routes
  const { convertVideo, estimateFileSize } = await import('./gifConverter');
  const { insertGifConversionSchema } = await import('@shared/schema');

  // Serve generated GIF/WebP files
  app.use('/gif-conversions', express.static(path.join(process.cwd(), 'public', 'gif-conversions')));

  // Create chunked upload session (bypasses body size limits via streaming)
  app.post("/api/gif-conversions/chunked-upload/session", async (req, res) => {
    try {
      const { filename, contentType } = req.body;
      
      if (!filename || !contentType) {
        return res.status(400).json({ error: 'Missing filename or contentType' });
      }

      console.log(`[GIF Upload] Creating chunked upload session for ${filename}`);
      
      const { createUploadSession } = await import('./objectStorage');
      const sessionInfo = await createUploadSession(filename, contentType);
      
      console.log(`[GIF Upload] Session created: ${sessionInfo.sessionId}`);
      res.json({ success: true, ...sessionInfo });
    } catch (error: any) {
      console.error('Session creation error:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to create upload session'
      });
    }
  });

  // Upload a chunk (raw body, no parsing)
  // Note: We skip the global JSON parser by manually reading the raw stream
  app.post("/api/gif-conversions/chunked-upload/chunk", async (req, res) => {
    try {
      const { sessionId, chunkIndex, isLastChunk, filename, contentType } = req.query;
      
      if (!sessionId || chunkIndex === undefined || !filename || !contentType) {
        return res.status(400).json({ error: 'Missing required query parameters' });
      }

      // Manually read raw request body with 10MB limit (global JSON parser might consume it otherwise)
      const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
      const chunks: Buffer[] = [];
      let totalSize = 0;
      let limitExceeded = false;
      let resolved = false;
      
      const cleanup = () => {
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.removeAllListeners('error');
        req.removeAllListeners('close');
      };
      
      const chunk = await new Promise<Buffer>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => {
          if (limitExceeded) return; // Discard remaining data but let stream drain
          
          // Check if adding this chunk would exceed the limit BEFORE adding it
          if (totalSize + chunk.length > MAX_CHUNK_SIZE) {
            limitExceeded = true;
            // Don't pause - let stream drain naturally so 'end' fires
            return;
          }
          
          totalSize += chunk.length;
          chunks.push(chunk);
        });
        
        req.on('end', () => {
          if (resolved) return;
          resolved = true;
          cleanup();
          
          if (limitExceeded) {
            reject(new Error('LIMIT_EXCEEDED'));
          } else {
            resolve(Buffer.concat(chunks));
          }
        });
        
        req.on('error', (err) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          reject(err);
        });
        
        req.on('close', () => {
          if (resolved) return;
          resolved = true;
          cleanup();
          reject(new Error('Client disconnected'));
        });
      }).catch((error) => {
        cleanup();
        if (error.message === 'LIMIT_EXCEEDED') {
          throw { statusCode: 413, message: 'Chunk size exceeds 10MB limit' };
        }
        throw error;
      });
      
      console.log(`[GIF Upload] Received chunk ${chunkIndex} for session ${sessionId} (${chunk.length} bytes)`);

      const { uploadChunk } = await import('./objectStorage');
      await uploadChunk(
        sessionId as string,
        chunk,
        parseInt(chunkIndex as string),
        isLastChunk === 'true',
        filename as string,
        contentType as string
      );

      // If this was the last chunk, return the session ID (file is in local temp storage)
      if (isLastChunk === 'true') {
        console.log(`[GIF Upload] Upload complete, returning session ID for local processing: ${sessionId}`);
        res.json({ success: true, complete: true, sessionId, localUpload: true });
      } else {
        res.json({ success: true, complete: false });
      }
    } catch (error: any) {
      console.error('Chunk upload error:', error);
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ 
        error: error.message || 'Failed to upload chunk'
      });
    }
  });

  // Upload video for GIF conversion (legacy endpoint for small files)
  app.post("/api/gif-conversions/upload", upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No video file provided' });
      }

      // Upload to object storage (works in both dev and production)
      const filename = `gif-upload-${Date.now()}-${req.file.originalname}`;
      const storageUrl = await uploadToStorage(
        req.file.buffer,
        filename,
        req.file.mimetype
      );

      console.log(`[GIF Upload] Uploaded ${filename} to storage (${(req.file.size / (1024 * 1024)).toFixed(2)}MB)`);
      res.json({ success: true, videoUrl: storageUrl });
    } catch (error: any) {
      console.error('Video upload error:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to upload video',
        details: error.code === 'LIMIT_FILE_SIZE' ? 'File size exceeds 100MB limit' : undefined
      });
    }
  });

  // Create new GIF conversion
  app.post("/api/gif-conversions", async (req, res) => {
    try {
      const conversionData = insertGifConversionSchema.parse(req.body);
      
      // Create database record
      const conversion = await storage.createGifConversion({
        ...conversionData,
        status: 'processing'
      });

      // Start conversion in background
      (async () => {
        try {
          const result = await convertVideo({
            sourceVideoUrl: conversion.sourceVideoUrl,
            outputFormat: conversion.outputFormat as 'gif' | 'webp',
            cropX: conversion.cropX || undefined,
            cropY: conversion.cropY || undefined,
            cropWidth: conversion.cropWidth || undefined,
            cropHeight: conversion.cropHeight || undefined,
            startTime: conversion.startTime || undefined,
            endTime: conversion.endTime || undefined,
            quality: conversion.quality || undefined,
            fps: conversion.fps || undefined,
            width: conversion.width || undefined,
            height: conversion.height || undefined,
          });

          // Update with results
          await storage.updateGifConversion(conversion.id, {
            outputUrl: result.outputPath,
            fileSize: result.fileSize,
            duration: result.duration,
            status: 'completed'
          });
        } catch (error: any) {
          console.error('GIF conversion error:', error);
          await storage.updateGifConversion(conversion.id, {
            status: 'failed',
            errorMessage: error.message
          });
        }
      })();

      res.json({ success: true, conversion });
    } catch (error: any) {
      console.error('GIF conversion creation error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get all GIF conversions
  app.get("/api/gif-conversions", async (req, res) => {
    try {
      const conversions = await storage.getGifConversions();
      res.json({ success: true, conversions });
    } catch (error: any) {
      console.error('Get GIF conversions error:', error);
      res.status(500).json({ error: 'Failed to fetch conversions' });
    }
  });

  // Get specific GIF conversion
  app.get("/api/gif-conversions/:id", async (req, res) => {
    try {
      const conversion = await storage.getGifConversion(req.params.id);
      if (!conversion) {
        return res.status(404).json({ error: 'Conversion not found' });
      }
      res.json({ success: true, conversion });
    } catch (error: any) {
      console.error('Get GIF conversion error:', error);
      res.status(500).json({ error: 'Failed to fetch conversion' });
    }
  });

  // Estimate file sizes for both GIF and WebP
  app.post("/api/gif-conversions/estimate", async (req, res) => {
    try {
      const options = req.body;
      
      // Estimate both formats in parallel
      const [gifSize, webpSize] = await Promise.all([
        estimateFileSize({ ...options, outputFormat: 'gif' }),
        estimateFileSize({ ...options, outputFormat: 'webp' })
      ]);
      
      res.json({ 
        success: true, 
        estimatedGifSize: gifSize,
        estimatedWebpSize: webpSize
      });
    } catch (error: any) {
      console.error('File size estimation error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Convert to both GIF and WebP
  app.post("/api/gif-conversions/convert", async (req, res) => {
    const options = req.body;
    try {
      console.log('[GIF Converter] Starting conversion with options:', JSON.stringify(options, null, 2));
      
      // Convert to both formats in parallel
      console.log('[GIF Converter] Converting to GIF and WebP...');
      const [gifResult, webpResult] = await Promise.all([
        convertVideo({ ...options, outputFormat: 'gif' }),
        convertVideo({ ...options, outputFormat: 'webp' })
      ]);
      
      console.log('[GIF Converter] Conversion complete!', { 
        gif: gifResult.outputPath, 
        webp: webpResult.outputPath 
      });
      
      // Session files persist after conversion to allow re-conversion with different settings
      // User can manually clear session or it will be cleaned up on next server restart if unused
      
      res.json({ 
        success: true, 
        gifResult: {
          url: gifResult.outputPath,
          fileSize: gifResult.fileSize,
          duration: gifResult.duration
        },
        webpResult: {
          url: webpResult.outputPath,
          fileSize: webpResult.fileSize,
          duration: webpResult.duration
        }
      });
    } catch (error: any) {
      console.error('[GIF Converter] Conversion error:', error);
      console.error('[GIF Converter] Error stack:', error.stack);
      
      // Session files persist even on error to allow retry with different settings
      
      res.status(500).json({ error: error.message });
    }
  });

  // Delete GIF conversion
  app.delete("/api/gif-conversions/:id", async (req, res) => {
    try {
      const conversion = await storage.getGifConversion(req.params.id);
      if (!conversion) {
        return res.status(404).json({ error: 'Conversion not found' });
      }

      // Delete file if it exists
      if (conversion.outputUrl) {
        const filePath = path.join(process.cwd(), 'public', conversion.outputUrl);
        try {
          await fs.unlink(filePath);
        } catch (e) {
          // Ignore if file doesn't exist
        }
      }

      await storage.deleteGifConversion(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Delete GIF conversion error:', error);
      res.status(500).json({ error: 'Failed to delete conversion' });
    }
  });

  // ==================== MTP-Images (Cloudflare R2) Endpoints ====================
  
  // List all images from R2 bucket
  app.get("/api/mtp-images", async (req, res) => {
    try {
      if (!r2Client) {
        return res.status(503).json({
          success: false,
          error: "MTP-Images is not configured. Please set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, and CLOUDFLARE_R2_SECRET_ACCESS_KEY environment variables.",
          items: [],
          total: 0,
        });
      }
      
      const { search, prefix, folderId, fileType } = req.query;
      
      const command = new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix as string || "",
        MaxKeys: 1000,
      });
      
      const response = await r2Client.send(command);
      
      let items = (response.Contents || [])
        .filter(item => item.Key && !item.Key.startsWith('.temp/'))
        .map(item => ({
          key: item.Key,
          size: item.Size,
          lastModified: item.LastModified,
          url: `${R2_PUBLIC_URL}/${item.Key}`,
        }));
      
      // Filter by folder if folderId provided
      if (folderId && typeof folderId === 'string') {
        try {
          const folderImages = await storage.getImagesInFolder(folderId);
          const folderImageKeys = new Set(folderImages.map((fi: any) => fi.imageKey));
          items = items.filter(item => item.key && folderImageKeys.has(item.key));
        } catch (err) {
          console.warn("[MTP-Images] Invalid folderId, returning all images:", folderId);
          // Continue without filtering if folder lookup fails
        }
      }
      
      // Filter by search term if provided
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        items = items.filter(item => 
          item.key?.toLowerCase().includes(searchLower)
        );
      }
      
      // Filter by file type
      const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
      const videoExtensions = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'];
      
      if (fileType === 'videos') {
        items = items.filter(item => {
          const ext = item.key?.toLowerCase().split('.').pop();
          return videoExtensions.includes(ext || '');
        });
      } else if (fileType === 'images') {
        items = items.filter(item => {
          const ext = item.key?.toLowerCase().split('.').pop();
          return imageExtensions.includes(ext || '');
        });
      } else {
        // Default: include all supported media files (images + videos)
        const allSupportedExtensions = [...imageExtensions, ...videoExtensions];
        items = items.filter(item => {
          const ext = item.key?.toLowerCase().split('.').pop();
          return allSupportedExtensions.includes(ext || '');
        });
      }
      
      // Sort by lastModified descending (newest first)
      items.sort((a, b) => {
        const dateA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
        const dateB = b.lastModified ? new Date(b.lastModified).getTime() : 0;
        return dateB - dateA;
      });
      
      res.json({
        success: true,
        items,
        total: items.length,
      });
    } catch (error: any) {
      console.error("[MTP-Images] List error:", error);
      
      // Map AWS SDK errors to meaningful messages
      let statusCode = 500;
      let errorMessage = "Failed to list images";
      let errorCode = "UNKNOWN_ERROR";
      
      if (error.name === 'InvalidAccessKeyId' || error.Code === 'InvalidAccessKeyId') {
        statusCode = 401;
        errorMessage = "Invalid Cloudflare R2 access key. Please check your CLOUDFLARE_R2_ACCESS_KEY_ID.";
        errorCode = "INVALID_CREDENTIALS";
      } else if (error.name === 'SignatureDoesNotMatch' || error.Code === 'SignatureDoesNotMatch') {
        statusCode = 401;
        errorMessage = "Invalid Cloudflare R2 secret key. Please check your CLOUDFLARE_R2_SECRET_ACCESS_KEY.";
        errorCode = "INVALID_CREDENTIALS";
      } else if (error.name === 'AccessDenied' || error.Code === 'AccessDenied') {
        statusCode = 403;
        errorMessage = "Access denied to R2 bucket. Please check bucket permissions.";
        errorCode = "ACCESS_DENIED";
      } else if (error.name === 'NoSuchBucket' || error.Code === 'NoSuchBucket') {
        statusCode = 404;
        errorMessage = "R2 bucket 'entremaximages' not found. Please verify the bucket exists.";
        errorCode = "BUCKET_NOT_FOUND";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      res.status(statusCode).json({ 
        success: false, 
        error: errorMessage,
        code: errorCode,
        items: [],
        total: 0,
      });
    }
  });

  // Proxy endpoint to fetch image from R2 (avoids CORS issues)
  app.get("/api/mtp-images/proxy/:key(*)", async (req, res) => {
    try {
      if (!r2Client) {
        return res.status(503).json({
          success: false,
          error: "MTP-Images is not configured.",
        });
      }

      const key = req.params.key;
      if (!key) {
        return res.status(400).json({ success: false, error: "Image key is required" });
      }

      const command = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      });

      const response = await r2Client.send(command);
      
      if (!response.Body) {
        return res.status(404).json({ success: false, error: "Image not found" });
      }

      // Set appropriate headers
      res.setHeader('Content-Type', response.ContentType || 'image/png');
      res.setHeader('Content-Length', response.ContentLength || 0);
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      // Stream the response
      const stream = response.Body as NodeJS.ReadableStream;
      stream.pipe(res);
    } catch (error: any) {
      console.error("[MTP-Images] Proxy error:", error);
      res.status(500).json({ success: false, error: "Failed to fetch image" });
    }
  });
  
  // Upload image to R2 bucket
  app.post("/api/mtp-images/upload", upload.single('file'), async (req, res) => {
    try {
      if (!r2Client) {
        return res.status(503).json({
          success: false,
          error: "MTP-Images is not configured. Please set Cloudflare R2 environment variables.",
        });
      }
      
      const file = req.file;
      const { filename, folderId } = req.body;
      
      if (!file) {
        return res.status(400).json({ success: false, error: "No file provided" });
      }
      
      // Determine the key (path) for the file - always stored FLAT in R2 (no folder prefixes)
      // Folders are virtual and managed in the database only
      const originalName = filename || file.originalname;
      let sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      // Extract file extension from the provided name first, then fallback to actual uploaded file
      const extMatch = sanitizedName.match(/\.[^.]+$/);
      let ext = extMatch ? extMatch[0] : null;
      
      // If no extension in filename field, derive from the actual uploaded file
      if (!ext) {
        const origExtMatch = file.originalname?.match(/\.[^.]+$/);
        if (origExtMatch) {
          ext = origExtMatch[0];
        } else {
          // Fallback: derive from mimetype
          const mimeToExt: Record<string, string> = {
            'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
            'image/webp': '.webp', 'image/svg+xml': '.svg',
            'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
          };
          ext = mimeToExt[file.mimetype] || '.png';
        }
      }
      
      // Strip extension for validation, then we'll re-add it
      const nameWithoutExt = sanitizedName.replace(/\.[^.]+$/, '');
      
      // Validate structured naming format for all MTP uploads
      // Format: {category}-{type}-{sequence} (3 segments, no product/ID)
      //     or: {category}-{productid}-{type}-{sequence} (4 segments)
      //     or: {category}-{productid}-{type}-{variant}-{sequence} (5 segments)
      const segments = nameWithoutExt.split('-');
      
      // Must have 3-5 segments (product/ID and variant are optional)
      if (segments.length < 3 || segments.length > 5) {
        return res.status(400).json({ 
          success: false, 
          error: "Invalid filename format. Expected: category-type-sequence, category-productid-type-sequence, or category-productid-type-variant-sequence" 
        });
      }
      
      const lastSegment = segments[segments.length - 1];
      if (!/^\d+$/.test(lastSegment)) {
        return res.status(400).json({ 
          success: false, 
          error: "Invalid filename. Last segment (sequence) must be a number." 
        });
      }
      
      // All segments except sequence must be lowercase alphanumeric (no nested hyphens in individual segments)
      const nonSequenceSegments = segments.slice(0, -1);
      for (const segment of nonSequenceSegments) {
        if (!/^[a-z0-9]+$/.test(segment) || segment.length < 2) {
          return res.status(400).json({ 
            success: false, 
            error: `Invalid filename segment: "${segment}". Each segment must be at least 2 characters using lowercase letters and numbers only.` 
          });
        }
      }
      
      const prefix = segments.slice(0, -1).join('-'); // Everything except sequence
      let currentSequence = parseInt(lastSegment, 10);
      
      // Always ensure filename has extension - build it properly
      let finalName = `${nameWithoutExt}${ext}`;
      let key = finalName; // Flat storage - no folder prefix in R2
      const maxAttempts = 100;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const headCommand = new HeadObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
          });
          await r2Client.send(headCommand);
          // File exists, increment sequence and try again
          currentSequence++;
          const paddedSeq = String(currentSequence).padStart(3, '0');
          finalName = `${prefix}-${paddedSeq}${ext}`;
          key = finalName; // Flat storage
          console.log(`[MTP-Images] Filename taken, trying: ${finalName}`);
        } catch (headError: any) {
          if (headError.name === 'NotFound' || headError.$metadata?.httpStatusCode === 404) {
            break;
          }
          console.error("[MTP-Images] Error checking file existence:", headError);
          break;
        }
      }
      
      // Determine content type
      const contentType = file.mimetype || 'image/png';
      
      const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
      });
      
      await r2Client.send(command);
      
      // Associate image with folder in the database (virtual folder organization)
      if (folderId) {
        try {
          await storage.addImageToFolder(key, String(folderId));
          console.log(`[MTP-Images] Associated ${key} with folder ${folderId}`);
        } catch (folderError) {
          console.warn(`[MTP-Images] Failed to associate with folder ${folderId}:`, folderError);
        }
      }
      
      const publicUrl = `${R2_PUBLIC_URL}/${key}`;
      
      console.log(`[MTP-Images] Uploaded: ${key}`);
      
      res.json({
        success: true,
        key,
        url: publicUrl,
        size: file.size,
        finalFilename: finalName,
      });
    } catch (error: any) {
      console.error("[MTP-Images] Upload error:", error);
      
      let statusCode = 500;
      let errorMessage = "Failed to upload image";
      
      if (error.name === 'InvalidAccessKeyId' || error.name === 'SignatureDoesNotMatch') {
        statusCode = 401;
        errorMessage = "Invalid Cloudflare R2 credentials.";
      } else if (error.name === 'AccessDenied') {
        statusCode = 403;
        errorMessage = "Access denied. Check bucket write permissions.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      res.status(statusCode).json({ 
        success: false, 
        error: errorMessage,
      });
    }
  });
  
  // Delete image from R2 bucket
  app.delete("/api/mtp-images/:key(*)", async (req, res) => {
    try {
      if (!r2Client) {
        return res.status(503).json({
          success: false,
          error: "MTP-Images is not configured. Please set Cloudflare R2 environment variables.",
        });
      }
      
      const { key } = req.params;
      
      if (!key) {
        return res.status(400).json({ success: false, error: "No key provided" });
      }
      
      const command = new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      });
      
      await r2Client.send(command);
      
      console.log(`[MTP-Images] Deleted: ${key}`);
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("[MTP-Images] Delete error:", error);
      
      let statusCode = 500;
      let errorMessage = "Failed to delete image";
      
      if (error.name === 'InvalidAccessKeyId' || error.name === 'SignatureDoesNotMatch') {
        statusCode = 401;
        errorMessage = "Invalid Cloudflare R2 credentials.";
      } else if (error.name === 'AccessDenied') {
        statusCode = 403;
        errorMessage = "Access denied. Check bucket delete permissions.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      res.status(statusCode).json({ 
        success: false, 
        error: errorMessage,
      });
    }
  });

  // ==========================================
  // MTP-IMAGES FOLDER MANAGEMENT
  // ==========================================

  // Get all folders
  app.get("/api/mtp-folders", async (req, res) => {
    try {
      const folders = await storage.getMtpFolders();
      res.json({ success: true, folders });
    } catch (error) {
      console.error("[MTP-Folders] Error fetching folders:", error);
      res.status(500).json({ success: false, error: "Failed to fetch folders" });
    }
  });

  // Get folders by parent (for tree navigation)
  app.get("/api/mtp-folders/by-parent", async (req, res) => {
    try {
      const parentId = req.query.parentId as string | undefined;
      const folders = await storage.getMtpFoldersByParent(parentId || null);
      res.json({ success: true, folders });
    } catch (error) {
      console.error("[MTP-Folders] Error fetching folders by parent:", error);
      res.status(500).json({ success: false, error: "Failed to fetch folders" });
    }
  });

  // Get folder by ID
  app.get("/api/mtp-folders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const folder = await storage.getMtpFolder(id);
      if (!folder) {
        return res.status(404).json({ success: false, error: "Folder not found" });
      }
      res.json({ success: true, folder });
    } catch (error) {
      console.error("[MTP-Folders] Error fetching folder:", error);
      res.status(500).json({ success: false, error: "Failed to fetch folder" });
    }
  });

  // Get folder by share code (public endpoint) - returns full image data
  app.get("/api/mtp-folders/share/:shareCode", async (req, res) => {
    try {
      const { shareCode } = req.params;
      const folder = await storage.getMtpFolderByShareCode(shareCode);
      if (!folder) {
        return res.status(404).json({ success: false, error: "Shared folder not found" });
      }
      
      // Get images in this folder
      const imageAssociations = await storage.getImagesInFolder(folder.id);
      
      // Fetch actual image data from R2
      if (!r2Client) {
        return res.json({ 
          success: true, 
          folder, 
          images: [],
          error: "R2 not configured - cannot fetch images"
        });
      }
      
      // Get the image keys that are in this folder
      const imageKeysInFolder = new Set(imageAssociations.map(a => a.imageKey));
      
      // Fetch all images from R2 and filter to only those in the folder
      // This ensures public endpoint only returns scoped data
      const command = new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        MaxKeys: 1000,
      });
      const response = await r2Client.send(command);
      
      const folderImages = (response.Contents || [])
        .filter(item => item.Key && imageKeysInFolder.has(item.Key))
        .map(item => ({
          key: item.Key!,
          size: item.Size || 0,
          lastModified: item.LastModified?.toISOString() || new Date().toISOString(),
          url: `${R2_PUBLIC_URL}/${item.Key}`,
        }));
      
      res.json({ success: true, folder, images: folderImages });
    } catch (error) {
      console.error("[MTP-Folders] Error fetching shared folder:", error);
      res.status(500).json({ success: false, error: "Failed to fetch shared folder" });
    }
  });

  // Create folder
  app.post("/api/mtp-folders", async (req, res) => {
    try {
      const { name, parentId } = req.body;
      
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ success: false, error: "Folder name is required" });
      }
      
      // Generate share code from folder name + unique suffix (no DB lookup needed)
      const cleanName = name.trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
        .replace(/^-+|-+$/g, '')       // Remove leading/trailing hyphens
        .substring(0, 40);             // Limit length

      const uniqueSuffix = Math.random().toString(36).substring(2, 7);
      const shareCode = `${cleanName || 'folder'}-${uniqueSuffix}`;
      
      const folder = await storage.createMtpFolder({
        name: name.trim(),
        parentId: parentId || null,
        shareCode,
      });
      
      console.log(`[MTP-Folders] Created folder: ${folder.name} (${folder.id})`);
      res.json({ success: true, folder });
    } catch (error) {
      console.error("[MTP-Folders] Error creating folder:", error);
      res.status(500).json({ success: false, error: "Failed to create folder" });
    }
  });

  // Update folder
  app.patch("/api/mtp-folders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, parentId } = req.body;
      
      const updates: any = {};
      if (name !== undefined) {
        const trimmedName = name.trim();
        updates.name = trimmedName;
        
        // Update share code to match new name
        const cleanName = trimmedName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 50);
        
        // Check for existing share codes (excluding current folder) and append number if needed
        let shareCode = cleanName || 'folder';
        let counter = 1;
        let existingFolder = await storage.getMtpFolderByShareCode(shareCode);
        while (existingFolder && existingFolder.id !== id) {
          counter++;
          shareCode = `${cleanName || 'folder'}-${counter}`;
          existingFolder = await storage.getMtpFolderByShareCode(shareCode);
        }
        updates.shareCode = shareCode;
      }
      if (parentId !== undefined) {
        if (parentId !== null) {
          if (parentId === id) {
            return res.status(400).json({ success: false, error: "Cannot move a folder into itself" });
          }
          const allFolders = await storage.getMtpFolders();
          const parentExists = allFolders.find((f: any) => f.id === parentId);
          if (!parentExists) {
            return res.status(400).json({ success: false, error: "Target folder does not exist" });
          }
          let current: any = parentExists;
          while (current) {
            if (current.id === id) {
              return res.status(400).json({ success: false, error: "Cannot move a folder into one of its own subfolders" });
            }
            current = current.parentId ? allFolders.find((f: any) => f.id === current!.parentId) : undefined;
          }
        }
        updates.parentId = parentId;
      }
      
      const folder = await storage.updateMtpFolder(id, updates);
      if (!folder) {
        return res.status(404).json({ success: false, error: "Folder not found" });
      }
      
      console.log(`[MTP-Folders] Updated folder: ${folder.name} (${folder.id})`);
      res.json({ success: true, folder });
    } catch (error) {
      console.error("[MTP-Folders] Error updating folder:", error);
      res.status(500).json({ success: false, error: "Failed to update folder" });
    }
  });

  // Delete folder
  app.delete("/api/mtp-folders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteMtpFolder(id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: "Folder not found" });
      }
      
      console.log(`[MTP-Folders] Deleted folder: ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error("[MTP-Folders] Error deleting folder:", error);
      res.status(500).json({ success: false, error: "Failed to delete folder" });
    }
  });

  // Get images in folder
  app.get("/api/mtp-folders/:id/images", async (req, res) => {
    try {
      const { id } = req.params;
      const imageAssociations = await storage.getImagesInFolder(id);
      res.json({ success: true, imageKeys: imageAssociations.map(a => a.imageKey) });
    } catch (error) {
      console.error("[MTP-Folders] Error fetching folder images:", error);
      res.status(500).json({ success: false, error: "Failed to fetch folder images" });
    }
  });

  // Add image to folder
  app.post("/api/mtp-folders/:id/images", async (req, res) => {
    try {
      const { id } = req.params;
      const { imageKey } = req.body;
      
      if (!imageKey) {
        return res.status(400).json({ success: false, error: "Image key is required" });
      }
      
      await storage.addImageToFolder(imageKey, id);
      console.log(`[MTP-Folders] Added image ${imageKey} to folder ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error("[MTP-Folders] Error adding image to folder:", error);
      res.status(500).json({ success: false, error: "Failed to add image to folder" });
    }
  });

  // Move multiple images to folder (bulk)
  app.post("/api/mtp-folders/:id/images/bulk", async (req, res) => {
    try {
      const { id } = req.params;
      const { imageKeys } = req.body;
      
      if (!imageKeys || !Array.isArray(imageKeys) || imageKeys.length === 0) {
        return res.status(400).json({ success: false, error: "Image keys array is required" });
      }
      
      await storage.moveImagesToFolder(imageKeys, id);
      console.log(`[MTP-Folders] Moved ${imageKeys.length} images to folder ${id}`);
      res.json({ success: true, movedCount: imageKeys.length });
    } catch (error) {
      console.error("[MTP-Folders] Error moving images to folder:", error);
      res.status(500).json({ success: false, error: "Failed to move images to folder" });
    }
  });

  // Remove image from folder
  app.delete("/api/mtp-folders/:folderId/images/:imageKey(*)", async (req, res) => {
    try {
      const { folderId, imageKey } = req.params;
      await storage.removeImageFromFolder(imageKey, folderId);
      console.log(`[MTP-Folders] Removed image ${imageKey} from folder ${folderId}`);
      res.json({ success: true });
    } catch (error) {
      console.error("[MTP-Folders] Error removing image from folder:", error);
      res.status(500).json({ success: false, error: "Failed to remove image from folder" });
    }
  });

  // Get folder for an image
  app.get("/api/mtp-images/:key(*)/folder", async (req, res) => {
    try {
      const { key } = req.params;
      const imageFolder = await storage.getFolderForImage(key);
      if (!imageFolder) {
        return res.json({ success: true, folder: null });
      }
      const folder = await storage.getMtpFolder(imageFolder.folderId);
      res.json({ success: true, folder });
    } catch (error) {
      console.error("[MTP-Folders] Error fetching folder for image:", error);
      res.status(500).json({ success: false, error: "Failed to fetch folder for image" });
    }
  });

  // === MTP Naming Convention Endpoints ===
  
  // Get all naming categories
  app.get("/api/mtp-naming/categories", async (req, res) => {
    try {
      const categories = await storage.getMtpNamingCategories();
      res.json({ success: true, categories });
    } catch (error) {
      console.error("[MTP-Naming] Error fetching categories:", error);
      res.status(500).json({ success: false, error: "Failed to fetch categories" });
    }
  });

  // Create new naming category
  app.post("/api/mtp-naming/categories", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: "Name is required" });
      }
      const displayName = name.trim();
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!cleanName || cleanName.length < 2) {
        return res.status(400).json({ success: false, error: "Name must be at least 2 characters (lowercase letters and numbers only)" });
      }
      const existing = (await storage.getMtpNamingCategories()).find(c => c.name === cleanName);
      if (existing) {
        return res.status(400).json({ success: false, error: "Category already exists" });
      }
      const category = await storage.createMtpNamingCategory(cleanName, displayName);
      res.json({ success: true, category });
    } catch (error) {
      console.error("[MTP-Naming] Error creating category:", error);
      res.status(500).json({ success: false, error: "Failed to create category" });
    }
  });

  // Get all product IDs
  app.get("/api/mtp-naming/product-ids", async (req, res) => {
    try {
      const productIds = await storage.getMtpNamingProductIds();
      res.json({ success: true, productIds });
    } catch (error) {
      console.error("[MTP-Naming] Error fetching product IDs:", error);
      res.status(500).json({ success: false, error: "Failed to fetch product IDs" });
    }
  });

  // Create new product ID
  app.post("/api/mtp-naming/product-ids", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: "Name is required" });
      }
      const displayName = name.trim();
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!cleanName || cleanName.length < 2) {
        return res.status(400).json({ success: false, error: "Product ID must be at least 2 characters (lowercase letters and numbers only)" });
      }
      const existing = (await storage.getMtpNamingProductIds()).find(p => p.name === cleanName);
      if (existing) {
        return res.status(400).json({ success: false, error: "Product ID already exists" });
      }
      const productId = await storage.createMtpNamingProductId(cleanName, displayName);
      res.json({ success: true, productId });
    } catch (error) {
      console.error("[MTP-Naming] Error creating product ID:", error);
      res.status(500).json({ success: false, error: "Failed to create product ID" });
    }
  });

  // Get naming types (optionally filtered by category)
  app.get("/api/mtp-naming/types", async (req, res) => {
    try {
      const { categoryId } = req.query;
      const types = await storage.getMtpNamingTypes(categoryId as string | undefined);
      res.json({ success: true, types });
    } catch (error) {
      console.error("[MTP-Naming] Error fetching types:", error);
      res.status(500).json({ success: false, error: "Failed to fetch types" });
    }
  });

  // Create new naming type
  app.post("/api/mtp-naming/types", async (req, res) => {
    try {
      const { name, categoryId } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: "Name is required" });
      }
      if (!categoryId || typeof categoryId !== 'string') {
        return res.status(400).json({ success: false, error: "Category ID is required" });
      }
      const displayName = name.trim();
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!cleanName || cleanName.length < 2) {
        return res.status(400).json({ success: false, error: "Type must be at least 2 characters (lowercase letters and numbers only)" });
      }
      const existingTypes = await storage.getMtpNamingTypes(categoryId);
      if (existingTypes.find(t => t.name === cleanName)) {
        return res.status(400).json({ success: false, error: "Type already exists for this category" });
      }
      const type = await storage.createMtpNamingType(cleanName, categoryId, displayName);
      res.json({ success: true, type });
    } catch (error) {
      console.error("[MTP-Naming] Error creating type:", error);
      res.status(500).json({ success: false, error: "Failed to create type" });
    }
  });

  // Get next sequence number for a filename prefix
  app.get("/api/mtp-naming/next-sequence", async (req, res) => {
    try {
      const { prefix } = req.query;
      if (!prefix || typeof prefix !== 'string') {
        return res.json({ success: true, nextSequence: 1 });
      }
      
      if (!isR2Configured || !r2Client) {
        return res.json({ success: true, nextSequence: 1 });
      }
      
      // Fetch images from R2
      const command = new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        MaxKeys: 1000,
      });
      const response = await r2Client.send(command);
      const images = response.Contents || [];
      
      const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)`);
      let maxSequence = 0;
      
      for (const image of images) {
        const filename = (image.Key || '').split('/').pop()?.replace(/\.[^.]+$/, '') || '';
        const match = filename.match(pattern);
        if (match) {
          const seq = parseInt(match[1], 10);
          if (seq > maxSequence) maxSequence = seq;
        }
      }
      
      res.json({ success: true, nextSequence: maxSequence + 1 });
    } catch (error) {
      console.error("[MTP-Naming] Error getting next sequence:", error);
      res.status(500).json({ success: false, error: "Failed to get next sequence" });
    }
  });

  // Returns the current extension version from manifest.json — used by the
  // "Check for Updates" button in the extension to detect available updates.
  app.get("/api/extension/version", (req, res) => {
    try {
      const manifestPath = path.join(process.cwd(), 'chrome-extension', 'manifest.json');
      const manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
      res.json({ version: manifest.version, name: manifest.name });
    } catch (err) {
      res.status(500).json({ error: 'Could not read extension version' });
    }
  });

  // Download browser extension as a zip — supports chrome, edge, opera, vivaldi
  // Opera falls back to popup mode (no sidePanel API); others use side panel.
  app.get("/api/chrome-extension/download", async (req, res) => {
    const browser = ((req.query.browser as string) || 'chrome').toLowerCase();
    const validBrowsers = ['chrome', 'edge', 'opera', 'vivaldi', 'safari'];
    if (!validBrowsers.includes(browser)) {
      return res.status(400).json({ error: 'Invalid browser. Use chrome, edge, opera, or vivaldi.' });
    }

    try {
      const archiver = (await import('archiver')).default;
      const pathMod = await import('path');
      const fs = await import('fs');

      const extDir = pathMod.resolve(process.cwd(), 'chrome-extension');
      if (!fs.existsSync(extDir)) {
        return res.status(404).json({ error: 'Extension files not found' });
      }

      // Read base files to be overridden per-browser
      const manifestRaw = JSON.parse(fs.readFileSync(pathMod.join(extDir, 'manifest.json'), 'utf8'));
      let backgroundSrc: string = fs.readFileSync(pathMod.join(extDir, 'background.js'), 'utf8');

      // Apply browser-specific overrides
      const manifest = { ...manifestRaw };
      let folderName = 'creative-ai';
      let zipFilename = 'creative-ai-chrome-extension.zip';

      if (browser === 'edge') {
        manifest.name = 'Creative AI for Edge';
        folderName = 'creative-ai-edge';
        zipFilename = 'creative-ai-edge-extension.zip';
      } else if (browser === 'vivaldi') {
        manifest.name = 'Creative AI for Vivaldi';
        folderName = 'creative-ai-vivaldi';
        zipFilename = 'creative-ai-vivaldi-extension.zip';
      } else if (browser === 'opera') {
        // Opera does not support the sidePanel API — revert to classic popup
        manifest.name = 'Creative AI for Opera';
        manifest.permissions = (manifest.permissions || []).filter((p: string) => p !== 'sidePanel');
        if (manifest.action) manifest.action.default_popup = 'popup.html';
        delete manifest.side_panel;
        // Remove the setPanelBehavior call from background.js
        backgroundSrc = backgroundSrc.replace(
          /\s*\/\/[^\n]*open[^\n]*side panel[^\n]*\n\s*chrome\.sidePanel\.setPanelBehavior\([^)]+\);?/gi,
          ''
        ).replace(/\s*chrome\.sidePanel\.setPanelBehavior\([^)]+\);?/g, '');
        folderName = 'creative-ai-opera';
        zipFilename = 'creative-ai-opera-extension.zip';
      } else if (browser === 'safari') {
        // Safari uses the same popup fallback as Opera (no sidePanel API)
        // Users must convert it via xcrun safari-web-extension-converter
        manifest.name = 'Creative AI for Safari';
        manifest.permissions = (manifest.permissions || []).filter((p: string) => p !== 'sidePanel');
        if (manifest.action) manifest.action.default_popup = 'popup.html';
        delete manifest.side_panel;
        backgroundSrc = backgroundSrc.replace(
          /\s*\/\/[^\n]*open[^\n]*side panel[^\n]*\n\s*chrome\.sidePanel\.setPanelBehavior\([^)]+\);?/gi,
          ''
        ).replace(/\s*chrome\.sidePanel\.setPanelBehavior\([^)]+\);?/g, '');
        folderName = 'creative-ai-safari';
        zipFilename = 'creative-ai-safari-extension.zip';
      } else {
        // chrome (default)
        zipFilename = 'creative-ai-chrome-extension.zip';
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err: Error) => {
        console.error('[Extension Download] Archive error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to create zip' });
      });
      archive.pipe(res);

      // Add all extension files except the two we're overriding
      archive.glob('**/*', {
        cwd: extDir,
        ignore: ['manifest.json', 'background.js'],
        dot: true,
      } as any, { prefix: folderName } as any);

      // Inject the browser-specific overrides
      archive.append(JSON.stringify(manifest, null, 2), { name: `${folderName}/manifest.json` });
      archive.append(backgroundSrc, { name: `${folderName}/background.js` });

      await archive.finalize();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Extension Download] Error:', msg);
      if (!res.headersSent) res.status(500).json({ error: msg });
    }
  });

  // Lightweight auth-check endpoint for Chrome Extension "Test Connection"
  // Returns 200 if API key is valid, 401 if not, 503 if not configured.
  app.get("/api/mtp-images/auth-check", (req, res) => {
    const MTP_IMPORT_API_KEY = process.env.MTP_IMPORT_API_KEY;
    if (!MTP_IMPORT_API_KEY) {
      return res.status(503).json({ success: false, error: "Import API not configured" });
    }
    const providedKey = req.headers['x-api-key'];
    if (!providedKey || providedKey !== MTP_IMPORT_API_KEY) {
      return res.status(401).json({ success: false, error: "Invalid or missing API key" });
    }
    return res.json({ success: true, message: "API key valid" });
  });

  // Import images from URLs (used by Chrome Extension)
  // Accepts: POST /api/mtp-images/import-from-urls
  // Headers: x-api-key (must match MTP_IMPORT_API_KEY env var)
  // Body: {
  //   imageUrls: string[],          — public image URLs to download
  //   category: string,             — MTP category abbreviation (e.g. "pr", "ad")
  //   productId?: string,           — optional product/ID segment (e.g. "fb")
  //   type: string,                 — MTP type segment (e.g. "photo", "hero")
  //   variant?: string,             — optional variant segment (e.g. "blue")
  //   folderId?: number             — optional virtual folder ID
  // }
  // The server computes the prefix and sequence number, then generates filenames server-side.
  app.post("/api/mtp-images/import-from-urls", async (req, res) => {
    // --- API key auth ---
    const MTP_IMPORT_API_KEY = process.env.MTP_IMPORT_API_KEY;
    if (!MTP_IMPORT_API_KEY) {
      return res.status(503).json({ success: false, error: "Import API not configured (MTP_IMPORT_API_KEY not set)" });
    }
    const providedKey = req.headers['x-api-key'];
    if (!providedKey || providedKey !== MTP_IMPORT_API_KEY) {
      return res.status(401).json({ success: false, error: "Invalid or missing API key" });
    }

    if (!r2Client) {
      return res.status(503).json({ success: false, error: "MTP-Images R2 storage not configured" });
    }

    const { imageUrls, category, productId, type: typeSegment, variant, folderId, convertToWebP } = req.body;
    // convertToWebP: true by default when not specified; false to keep original format
    const shouldConvertWebP: boolean = convertToWebP !== false;

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ success: false, error: "imageUrls array is required" });
    }
    if (imageUrls.length > 50) {
      return res.status(400).json({ success: false, error: "Maximum 50 images per request" });
    }
    if (!category || typeof category !== 'string' || !/^[a-z0-9]+$/.test(category) || category.length < 2) {
      return res.status(400).json({ success: false, error: "category is required (lowercase alphanumeric, min 2 chars)" });
    }
    if (!typeSegment || typeof typeSegment !== 'string' || !/^[a-z0-9]+$/.test(typeSegment) || typeSegment.length < 2) {
      return res.status(400).json({ success: false, error: "type is required (lowercase alphanumeric, min 2 chars)" });
    }
    if (productId && (typeof productId !== 'string' || !/^[a-z0-9]+$/.test(productId) || productId.length < 2)) {
      return res.status(400).json({ success: false, error: "productId must be lowercase alphanumeric, min 2 chars" });
    }
    if (variant && (typeof variant !== 'string' || !/^[a-z0-9]+$/.test(variant))) {
      return res.status(400).json({ success: false, error: "variant must be lowercase alphanumeric" });
    }

    // Build the MTP prefix: category[-productId]-type[-variant]
    const prefixParts = [category, productId, typeSegment, variant].filter(Boolean) as string[];
    const filenamePrefix = prefixParts.join('-');

    // --- SSRF protection ---
    // isPrivateIp checks an IP address string (IPv4 or IPv6) for private/reserved ranges.
    // Covers: loopback, private RFC1918, link-local, CGNAT, broadcast, multicast,
    // reserved, IPv4-mapped IPv6 (::ffff:*), ULA, and IPv6 link-local.
    function isPrivateIp(ip: string): boolean {
      const addr = ip.toLowerCase().trim();

      // Strip IPv6 zone ID (e.g. "fe80::1%eth0")
      const bare = addr.split('%')[0];

      // IPv4-mapped IPv6: ::ffff:a.b.c.d or ::ffff:aabb:ccdd
      const mappedV4Dotted = bare.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
      if (mappedV4Dotted) {
        return isPrivateIp(mappedV4Dotted[1]); // recurse with the embedded IPv4
      }
      const mappedV4Hex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (mappedV4Hex) {
        // Convert 16-bit hex groups to dotted-decimal
        const hi = parseInt(mappedV4Hex[1], 16);
        const lo = parseInt(mappedV4Hex[2], 16);
        const a = (hi >> 8) & 0xff, b = hi & 0xff, c = (lo >> 8) & 0xff, d = lo & 0xff;
        return isPrivateIp(`${a}.${b}.${c}.${d}`);
      }

      // Standard IPv4 dotted-decimal
      const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (v4) {
        const [a, b, c, d] = v4.slice(1).map(Number);
        // Validate octets
        if (a > 255 || b > 255 || c > 255 || d > 255) return true; // malformed → block
        return (
          a === 0 ||                                     // 0.0.0.0/8 (this network)
          a === 10 ||                                    // 10.0.0.0/8 (private)
          a === 127 ||                                   // 127.0.0.0/8 (loopback)
          (a === 100 && b >= 64 && b <= 127) ||          // 100.64.0.0/10 (CGNAT)
          (a === 169 && b === 254) ||                    // 169.254.0.0/16 (link-local)
          (a === 172 && b >= 16 && b <= 31) ||           // 172.16.0.0/12 (private)
          (a === 192 && b === 0 && c === 0) ||           // 192.0.0.0/24 (IANA special)
          (a === 192 && b === 0 && c === 2) ||           // 192.0.2.0/24 (TEST-NET-1)
          (a === 192 && b === 168) ||                    // 192.168.0.0/16 (private)
          (a === 198 && b >= 18 && b <= 19) ||           // 198.18.0.0/15 (benchmarking)
          (a === 198 && b === 51 && c === 100) ||        // 198.51.100.0/24 (TEST-NET-2)
          (a === 203 && b === 0 && c === 113) ||         // 203.0.113.0/24 (TEST-NET-3)
          a >= 224                                       // 224+: multicast, reserved, broadcast
        );
      }

      // IPv6 checks
      return (
        bare === '::1' ||                        // IPv6 loopback
        bare === '::' ||                         // unspecified
        bare.startsWith('fe80:') ||              // link-local
        bare.startsWith('fc') ||                 // ULA
        bare.startsWith('fd') ||                 // ULA
        bare.startsWith('ff') ||                 // multicast
        bare.startsWith('2001:db8:') ||          // documentation prefix
        bare.startsWith('100::') ||              // discard prefix (100::/64)
        bare === '::ffff:0:0'                    // extra mapped form
      );
    }

    async function assertSafeUrl(rawUrl: string): Promise<void> {
      let parsed: URL;
      try { parsed = new URL(rawUrl); } catch { throw new Error('Invalid URL format'); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Protocol not allowed: ${parsed.protocol}`);
      }
      const hostname = parsed.hostname.toLowerCase();
      // Block literal localhost
      if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new Error('Localhost URLs are not allowed');
      }
      // Block known metadata hostnames
      if (['metadata.google.internal', 'metadata.internal', '169.254.169.254'].includes(hostname)) {
        throw new Error('Cloud metadata endpoints are not allowed');
      }
      // Check literal IP addresses immediately
      if (/^[\d.]+$/.test(hostname) || hostname.startsWith('[')) {
        const bare = hostname.replace(/^\[|\]$/g, '');
        if (isPrivateIp(bare)) throw new Error('Private/reserved IP addresses are not allowed');
        return; // literal public IP → safe
      }
      // Resolve hostname to catch DNS-rebinding attacks.
      // dns.lookup with {all:true} always returns an array of {address,family} records.
      const { promises: dnsPromises } = await import('dns');
      let addrs: string[] = [];
      try {
        const results = await dnsPromises.lookup(hostname, { all: true });
        // results is always LookupAddress[] when all:true; each entry has an `address` string
        addrs = results.map(entry => entry.address);
      } catch {
        throw new Error(`DNS resolution failed for host: ${hostname}`);
      }
      for (const addr of addrs) {
        if (isPrivateIp(addr)) {
          throw new Error(`Host resolves to private IP (${addr}), blocked for security`);
        }
      }
    }

    // Helper: compute next sequence by scanning R2 for existing files with same prefix.
    // Uses paginated listing to handle buckets with more than 1000 objects.
    async function computeNextSequence(prefix: string): Promise<number> {
      try {
        const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)`);
        let maxSeq = 0;
        let continuationToken: string | undefined;
        do {
          const listCmd = new ListObjectsV2Command({
            Bucket: R2_BUCKET_NAME,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
          });
          const listResp = await r2Client!.send(listCmd);
          for (const obj of listResp.Contents || []) {
            const fname = (obj.Key || '').replace(/\.[^.]+$/, '');
            const m = fname.match(pattern);
            if (m) { const s = parseInt(m[1], 10); if (s > maxSeq) maxSeq = s; }
          }
          continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
        } while (continuationToken);
        return maxSeq + 1;
      } catch { return 1; }
    }

    // Helper: find next available key in R2.
    // Only treats confirmed 404 (NotFound) as available.
    // Non-404 errors are surfaced as exceptions (not treated as "available").
    async function findAvailableKey(prefix: string, startSeq: number, ext: string): Promise<{ key: string; finalName: string; nextSeq: number }> {
      let seq = startSeq;
      while (true) {
        const paddedSeq = String(seq).padStart(3, '0');
        const finalName = `${prefix}-${paddedSeq}`;
        const key = `${finalName}${ext}`;
        try {
          await r2Client!.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
          seq++; // File exists, try next
        } catch (headError) {
          // Treat only confirmed NotFound (404) as "key available".
          // We check `name` and `$metadata.httpStatusCode` via safe runtime guards.
          const errName = headError instanceof Error ? headError.name : '';
          const httpStatus =
            headError !== null &&
            typeof headError === 'object' &&
            '$metadata' in headError &&
            headError.$metadata !== null &&
            typeof headError.$metadata === 'object' &&
            'httpStatusCode' in headError.$metadata
              ? headError.$metadata.httpStatusCode
              : undefined;
          if (errName === 'NotFound' || httpStatus === 404) {
            return { key, finalName, nextSeq: seq + 1 }; // confirmed available
          }
          // Non-404 R2 error → propagate so the caller can mark this image as failed
          const msg = headError instanceof Error ? headError.message : String(headError);
          throw new Error(`R2 availability check failed for key "${key}": ${msg}`);
        }
      }
    }

    // Helper: fetch image with SSRF-safe redirect handling.
    // We disable automatic redirect-following so each hop's destination URL
    // is validated through assertSafeUrl() before following. This prevents
    // redirect-based SSRF (e.g. public URL 301→ 169.254.169.254).
    const MAX_IMAGE_BYTES = 200 * 1024 * 1024; // 200 MB — supports videos
    const MAX_REDIRECTS = 5;
    const ALLOWED_MIME_TYPES = new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'image/bmp', 'image/tiff', 'image/heic', 'image/heif',
      'video/mp4', 'video/x-m4v', 'video/webm', 'video/quicktime',
      'video/x-msvideo', 'video/x-matroska', 'video/x-ms-wmv',
      'video/x-flv', 'video/x-f4v', 'video/mp2t', 'video/mpeg',
      'video/3gpp', 'video/3gpp2', 'video/ogg', 'video/divx',
      'video/x-ms-asf', 'video/x-divx', 'video/dv', 'application/mxf',
      'application/x-mpegurl', 'application/vnd.apple.mpegurl',
      'application/dash+xml',
      // Fallback: some servers return generic octet-stream for video files
      'application/octet-stream',
    ]);

    async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
      let currentUrl = url;
      let redirectCount = 0;

      while (true) {
        // Validate current URL (incl. post-DNS IP check) before every hop
        await assertSafeUrl(currentUrl);

        const response = await fetch(currentUrl, {
          headers: { 'User-Agent': 'MTP-Image-Importer/1.0' },
          redirect: 'manual', // never auto-follow — we control each hop
          signal: AbortSignal.timeout(30000),
        });

        // Handle redirects explicitly
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new Error(`Redirect with no Location header (HTTP ${response.status})`);
          if (redirectCount >= MAX_REDIRECTS) throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
          // Resolve potentially relative redirect URL against current
          currentUrl = new URL(location, currentUrl).toString();
          redirectCount++;
          continue;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status} fetching image`);

        const rawContentType = response.headers.get('content-type') || 'image/jpeg';
        const contentType = rawContentType.split(';')[0].trim().toLowerCase();

        if (!ALLOWED_MIME_TYPES.has(contentType)) {
          throw new Error(`Content-type not allowed: ${contentType}`);
        }

        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > MAX_IMAGE_BYTES) {
          throw new Error(`Image too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
          throw new Error(`Image too large: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
        }

        return { buffer: Buffer.from(arrayBuffer), contentType };
      }
    }

    // Helper: derive extension from content-type or URL
    function deriveExtension(contentType: string, url: string): string {
      const mimeMap: Record<string, string> = {
        'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
        'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
        'image/bmp': '.bmp', 'image/tiff': '.tiff',
        'image/heic': '.heic', 'image/heif': '.heif',
        'video/mp4': '.mp4', 'video/x-m4v': '.m4v', 'video/webm': '.webm',
        'video/quicktime': '.mov', 'video/x-msvideo': '.avi',
        'video/x-matroska': '.mkv', 'video/x-ms-wmv': '.wmv',
        'video/x-flv': '.flv', 'video/x-f4v': '.f4v',
        'video/mp2t': '.ts', 'video/mpeg': '.mpg',
        'video/3gpp': '.3gp', 'video/3gpp2': '.3g2', 'video/ogg': '.ogv',
        'video/divx': '.divx', 'video/x-divx': '.divx',
        'video/x-ms-asf': '.asf', 'video/dv': '.dv', 'application/mxf': '.mxf',
        'application/x-mpegurl': '.m3u8', 'application/vnd.apple.mpegurl': '.m3u8',
        'application/dash+xml': '.mpd',
      };
      const fromMime = mimeMap[contentType.split(';')[0].trim().toLowerCase()];
      if (fromMime) return fromMime;
      // Fall back to URL extension — most reliable for videos served as octet-stream
      const urlMatch = url.split('?')[0].match(/\.[a-z0-9]+$/i);
      return urlMatch ? urlMatch[0].toLowerCase() : '.jpg';
    }

    // Optional per-image base64 data pre-fetched by the extension
    // (used for auth-gated URLs like Google Drive that the server can't access)
    const imageDataBase64: (string | null)[] = Array.isArray(req.body.imageDataBase64)
      ? req.body.imageDataBase64
      : [];

    // Helper: decode a data-URL string into buffer + content-type
    function decodeBase64DataUrl(dataUrl: string): { buffer: Buffer; contentType: string } | null {
      try {
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx < 0) return null;
        const header = dataUrl.substring(0, commaIdx);
        const mimeMatch = header.match(/data:([^;,]+)/);
        const contentType = mimeMatch ? mimeMatch[1].toLowerCase() : 'image/jpeg';
        const buffer = Buffer.from(dataUrl.substring(commaIdx + 1), 'base64');
        return { buffer, contentType };
      } catch { return null; }
    }

    // Compute the starting sequence number once for the whole batch
    let currentSeq = await computeNextSequence(filenamePrefix);

    const results: Array<{
      originalUrl: string;
      success: boolean;
      key?: string;
      url?: string;
      filename?: string;
      error?: string;
    }> = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];
      if (!imageUrl || typeof imageUrl !== 'string') {
        results.push({ originalUrl: imageUrl || '', success: false, error: 'Missing URL' });
        continue;
      }

      try {
        let buffer: Buffer;
        let contentType: string;

        const b64 = imageDataBase64[i];
        if (b64 && typeof b64 === 'string' && b64.startsWith('data:')) {
          // Extension pre-fetched the image (Google Drive, etc.) — use it directly
          const decoded = decodeBase64DataUrl(b64);
          if (!decoded) throw new Error('Invalid base64 image data from extension');
          ({ buffer, contentType } = decoded);
          if (!ALLOWED_MIME_TYPES.has(contentType)) {
            throw new Error(`Content-type not allowed: ${contentType}`);
          }
          if (buffer.byteLength > MAX_IMAGE_BYTES) {
            throw new Error(`Image too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
          }
        } else {
          // Standard path: fetch from URL with SSRF protection
          ({ buffer, contentType } = await fetchImageBuffer(imageUrl));
        }

        let ext = deriveExtension(contentType, imageUrl);

        // ── Step 1: Detect real format from buffer magic bytes ────────────────
        // Check for HEIC first via ftyp box (Sharp cannot read HEIC when
        // libheif is not compiled into the native binary, so we must detect
        // HEIC independently before calling any Sharp metadata API).
        const isHeicBuffer = (buf: Buffer): boolean => {
          if (buf.length < 12) return false;
          const boxType = buf.slice(4, 8).toString('ascii');
          if (boxType !== 'ftyp') return false;
          const brand = buf.slice(8, 12).toString('ascii');
          return ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'avif'].some(b => brand.startsWith(b));
        };

        if (isHeicBuffer(buffer)) {
          if (contentType !== 'image/heic' && contentType !== 'image/heif') {
            console.log(`[MTP-Import] Format mismatch: CDN said "${contentType}" but buffer is HEIC — using detected type`);
          }
          contentType = 'image/heic';
          ext = '.heic';
        } else {
          // Use Sharp to detect format for all other image types
          const FORMAT_TO_MIME: Record<string, string> = {
            jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
            webp: 'image/webp', tiff: 'image/tiff',
            bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
          };
          try {
            const meta = await sharp(buffer).metadata();
            if (meta.format && FORMAT_TO_MIME[meta.format]) {
              const detectedMime = FORMAT_TO_MIME[meta.format];
              if (detectedMime !== contentType) {
                console.log(`[MTP-Import] Format mismatch: CDN said "${contentType}" but buffer is "${meta.format}" — using detected type`);
                contentType = detectedMime;
                ext = deriveExtension(contentType, imageUrl);
              }
            }
          } catch (metaErr) {
            console.warn(`[MTP-Import] Could not detect format from buffer:`, metaErr);
          }
        }

        // ── Step 2: WebP conversion (static images + GIFs, not video/SVG) ────
        const WEBP_CONVERTIBLE = new Set([
          'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
          'image/bmp', 'image/tiff', 'image/heic', 'image/heif', 'image/avif',
        ]);
        if (shouldConvertWebP && WEBP_CONVERTIBLE.has(contentType)) {
          if (contentType === 'image/heic' || contentType === 'image/heif') {
            // Sharp cannot decode HEIC without libheif — use heic-convert to get
            // raw JPEG bytes first, then let Sharp compress to WebP
            try {
              const jpegBuffer = await heicConvert({ buffer, format: 'JPEG', quality: 0.92 });
              buffer = await sharp(Buffer.from(jpegBuffer)).webp({ quality: 85 }).toBuffer();
              contentType = 'image/webp';
              ext = '.webp';
              console.log(`[MTP-Import] Converted HEIC → JPEG → WebP`);
            } catch (convertErr) {
              const msg = convertErr instanceof Error ? convertErr.message : String(convertErr);
              throw new Error(`WebP conversion failed (HEIC→JPEG→WebP): ${msg}`);
            }
          } else {
            const isAnimated = contentType === 'image/gif';
            try {
              buffer = await sharp(buffer, { animated: isAnimated }).webp({ quality: 85 }).toBuffer();
              contentType = 'image/webp';
              ext = '.webp';
              console.log(`[MTP-Import] Converted to WebP${isAnimated ? ' (animated)' : ''}`);
            } catch (convertErr) {
              const msg = convertErr instanceof Error ? convertErr.message : String(convertErr);
              throw new Error(`WebP conversion failed (detected: ${contentType}): ${msg}`);
            }
          }
        }

        // Find an available key starting from currentSeq
        const { key, finalName, nextSeq } = await findAvailableKey(filenamePrefix, currentSeq, ext);
        currentSeq = nextSeq; // advance for next image in batch

        // Upload to R2
        await r2Client!.send(new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }));

        // Associate with folder if provided
        if (folderId) {
          try {
            await storage.addImageToFolder(key, String(folderId));
          } catch (folderErr) {
            console.warn(`[MTP-Import] Failed to associate ${key} with folder ${folderId}:`, folderErr);
          }
        }

        const publicUrl = `${R2_PUBLIC_URL}/${key}`;
        console.log(`[MTP-Import] Uploaded: ${key} (from ${imageUrl.substring(0, 80)})`);

        results.push({ originalUrl: imageUrl, success: true, key, url: publicUrl, filename: finalName });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[MTP-Import] Failed to import ${imageUrl}:`, errMsg);
        results.push({ originalUrl: imageUrl, success: false, error: errMsg });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
      success: successCount > 0,
      results,
      imported: successCount,
      failed: results.length - successCount,
    });
  });

  const httpServer = createServer(app);

  return httpServer;
}
