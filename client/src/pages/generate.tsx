import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import type { InsertEmail, Email } from "@shared/schema";
import { EmailGeneratorForm, type GenerateConfig } from "@/components/email-generator-form";
import { EmailPreview } from "@/components/email-preview";
import { EmailEditor } from "@/components/email-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Trophy, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const STORAGE_KEY_PREFIX = "email-generator-";
const STORAGE_KEYS = {
  variations: `${STORAGE_KEY_PREFIX}variations`,
  activeVariation: `${STORAGE_KEY_PREFIX}active-variation`,
  lastConfig: `${STORAGE_KEY_PREFIX}last-config`,
  pendingSessionId: `${STORAGE_KEY_PREFIX}pending-session`,
} as const;

interface EmailVariation {
  id: string;
  subjects: string[];
  body: string;
  htmlBody: string;
  edited?: boolean;
  originalSubjects?: string[];
  originalBody?: string;
  originalHtmlBody?: string;
  aiProvider?: 'gpt-5' | 'claude' | 'claude-sonnet-4.5' | 'claude-sonnet-4';
}

// Convert plain text body with HTML tags to proper HTML format
function convertBodyToHtml(body: string): string {
  // Split by triple line breaks (paragraph separators)
  const paragraphs = body.split('\n\n\n').filter(p => p.trim());
  
  // Wrap each paragraph in <p> tags with styling, and convert internal newlines to <br>
  return paragraphs
    .map(p => `<p style='margin:0 0 16px; line-height:1.6; color:#000;'>${p.trim().replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export default function GeneratePage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Parse query parameters to check for reuse
  const urlParams = new URLSearchParams(window.location.search);
  const reuseEmailId = urlParams.get('reuse');

  // Fetch email data if reusing
  const { data: reuseEmailData } = useQuery<{ email: Email }>({
    queryKey: ['/api/emails', reuseEmailId],
    enabled: !!reuseEmailId,
  });

  // Fetch products from API
  const { data: productsData } = useQuery<{ success: boolean; products: import("@shared/schema").Product[] }>({
    queryKey: ["/api/products"],
  });

  const mockProducts = productsData?.products || [];

  // Mutation to save email to library
  const saveEmailMutation = useMutation({
    mutationFn: async (emailData: InsertEmail) => {
      const res = await apiRequest("POST", "/api/emails", emailData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      toast({
        title: "Success",
        description: "Email saved to library",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to save email to library",
        variant: "destructive",
      });
      console.error("Error saving email:", error);
    },
  });

  const [isGenerating, setIsGenerating] = useState(() => {
    // If there's a pending session, start in generating state
    return !!localStorage.getItem(STORAGE_KEYS.pendingSessionId);
  });
  const [generationProgress, setGenerationProgress] = useState(() => {
    // If there's a pending session, show progress
    return localStorage.getItem(STORAGE_KEYS.pendingSessionId) ? 50 : 0;
  });
  const [generationStatus, setGenerationStatus] = useState(() => {
    // If there's a pending session, show status
    return localStorage.getItem(STORAGE_KEYS.pendingSessionId) ? "Checking for your emails..." : "";
  });
  const [generationErrors, setGenerationErrors] = useState<{ gpt?: string | null; claude?: string | null; claudeSonnet45?: string | null }>({});
  const [isRecovering, setIsRecovering] = useState(false);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);
  const shouldClearPendingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const defaultEmailVariations: EmailVariation[] = [
    {
      id: "1",
      subjects: ["Welcome to Entremax Creative AI"],
      body: "Select one product and configure your email settings on the left, then click Generate to create 5 AI-powered email variations.",
      htmlBody: "<div style='font-family: sans-serif; color: #000; line-height: 1.8;'><p>Select one product and configure your email settings on the left, then click <strong>Generate</strong> to create <strong>5 AI-powered email variations</strong>.</p></div>",
    },
  ];
  
  const [emailVariations, setEmailVariations] = useState<EmailVariation[]>(() => {
    // Don't load old emails from localStorage if there's a pending recovery
    const pendingSessionId = localStorage.getItem(STORAGE_KEYS.pendingSessionId);
    if (pendingSessionId) {
      console.log("Pending sessionId found - skipping localStorage email load");
      return defaultEmailVariations;
    }
    
    const stored = localStorage.getItem(STORAGE_KEYS.variations);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error("Failed to parse stored variations:", e);
      }
    }
    return defaultEmailVariations;
  });
  
  const [activeVariation, setActiveVariation] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.activeVariation) || "1";
  });

  const [gptSectionOpen, setGptSectionOpen] = useState(true);
  const [claudeSectionOpen, setClaudeSectionOpen] = useState(true);
  
  const [lastConfig, setLastConfig] = useState<GenerateConfig | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.lastConfig);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error("Failed to parse stored config:", e);
      }
    }
    return null;
  });
  
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingVariation, setEditingVariation] = useState<EmailVariation | null>(null);
  
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.variations, JSON.stringify(emailVariations));
    } catch (e) {
      console.error("Failed to save email variations to localStorage:", e);
    }
  }, [emailVariations]);
  
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.activeVariation, activeVariation);
    } catch (e) {
      console.error("Failed to save active variation to localStorage:", e);
    }
  }, [activeVariation]);
  
  useEffect(() => {
    if (lastConfig) {
      try {
        localStorage.setItem(STORAGE_KEYS.lastConfig, JSON.stringify(lastConfig));
      } catch (e) {
        console.error("Failed to save last config to localStorage:", e);
      }
    }
  }, [lastConfig]);

  // Simple cleanup: Clear sessionId after emails have been displayed for 3 seconds
  useEffect(() => {
    const hasEmails = emailVariations.length > 1;
    const notGenerating = !isGenerating;
    
    if (hasEmails && notGenerating) {
      // User has viewed emails for a bit, clear the session
      const timer = setTimeout(() => {
        const pendingSessionId = localStorage.getItem(STORAGE_KEYS.pendingSessionId);
        if (pendingSessionId) {
          localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
          localStorage.removeItem(STORAGE_KEYS.pendingSessionId + '_timestamp');
          console.log("Cleared pending sessionId after emails displayed");
        }
      }, 3000); // Wait 3 seconds before clearing
      
      return () => clearTimeout(timer);
    }
  }, [isGenerating, emailVariations]);

  // Recovery useEffect - check for pending sessions on mount
  useEffect(() => {
    const recoverPendingSession = async () => {
      const pendingSessionId = localStorage.getItem(STORAGE_KEYS.pendingSessionId);
      
      if (!pendingSessionId || !isInitialMount.current) {
        isInitialMount.current = false;
        return;
      }

      // Check if sessionId is too old (more than 5 minutes) - if so, clear it
      const sessionTimestamp = localStorage.getItem(STORAGE_KEYS.pendingSessionId + '_timestamp');
      if (!sessionTimestamp) {
        // No timestamp means it's from before this fix - clear it immediately
        console.log("Session has no timestamp (old session), clearing:", pendingSessionId);
        localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
        isInitialMount.current = false;
        return;
      }
      
      const timestamp = parseInt(sessionTimestamp, 10);
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;
      if (now - timestamp > fiveMinutes) {
        console.log("Session too old, clearing:", pendingSessionId);
        localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
        localStorage.removeItem(STORAGE_KEYS.pendingSessionId + '_timestamp');
        isInitialMount.current = false;
        return;
      }

      console.log("Found pending session, attempting recovery:", pendingSessionId);
      
      // Clear old emails and show generating state
      setEmailVariations(defaultEmailVariations);
      setActiveVariation("1");
      setIsGenerating(true);
      setGenerationStatus("Checking for your emails...");
      setGenerationProgress(50);

      try {
        // Poll for emails up to 2 minutes (24 attempts * 5 seconds)
        const maxAttempts = 24;
        let attempts = 0;
        let emailsFound = false;

        while (attempts < maxAttempts && !emailsFound) {
          attempts++;
          console.log(`Recovery attempt ${attempts}/${maxAttempts}`);
          
          const progressPercent = 50 + Math.floor((attempts / maxAttempts) * 45); // 50% to 95%
          setGenerationProgress(progressPercent);
          setGenerationStatus(attempts === 1 ? 
            "Your emails are still being generated... this usually takes 20-40 seconds" : 
            `Still generating your emails... (${Math.floor(attempts * 5)}s elapsed)`
          );

          const response = await fetch(`/api/emails/session/${pendingSessionId}`);
          const data = await response.json();

          if (data.success && data.emails && data.emails.length > 0) {
            console.log(`Recovered ${data.emails.length} emails from session`);
            emailsFound = true;

            // Convert database emails to EmailVariation format
            const recovered: EmailVariation[] = data.emails.map((email: Email, idx: number) => ({
              id: email.aiProvider ? `${email.aiProvider}-${idx + 1}` : `recovered-${idx + 1}`,
              subjects: email.subjects || [email.subject],
              body: email.body,
              htmlBody: email.htmlBody || convertBodyToHtml(email.body),
              aiProvider: email.aiProvider,
            }));

            setEmailVariations(recovered);
            // Set active variation to first Claude variant if available, otherwise first recovered
            const claudeRecovered = recovered.filter(e => e.aiProvider === 'claude');
            setActiveVariation(claudeRecovered[0]?.id || recovered[0]?.id || "1");
            
            // Set Claude section open and GPT section collapsed
            setClaudeSectionOpen(true);
            setGptSectionOpen(false);
            
            // DON'T clear pendingSessionId here - let the unmount cleanup handle it
            // This allows repeated navigation to still show recovery if user keeps leaving/coming back

            setGenerationProgress(100);
            setGenerationStatus("Complete!");

            toast({
              title: "Emails Recovered",
              description: `Successfully recovered ${data.emails.length} email variations.`,
            });

            // Reset generating state after brief delay
            setTimeout(() => {
              setIsGenerating(false);
              setGenerationProgress(0);
              setGenerationStatus("");
            }, 500);
          } else if (attempts < maxAttempts) {
            // Wait 5 seconds before next attempt
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }

        if (!emailsFound) {
          // Timeout reached - clear session to prevent infinite loop
          console.log("Recovery timeout - no emails found after", maxAttempts, "attempts");
          localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
          localStorage.removeItem(STORAGE_KEYS.pendingSessionId + '_timestamp');
          
          setIsGenerating(false);
          setGenerationProgress(0);
          setGenerationStatus("");

          toast({
            title: "Generation Timeout",
            description: "Unable to recover emails. Please try generating again.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Error recovering session:", error);
        // Clear sessionId on error to prevent infinite loop
        localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
        localStorage.removeItem(STORAGE_KEYS.pendingSessionId + '_timestamp');
        
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");

        toast({
          title: "Recovery Error",
          description: "Failed to recover emails. Please try generating again.",
          variant: "destructive",
        });
      } finally {
        isInitialMount.current = false;
      }
    };

    recoverPendingSession();
  }, []); // Only run on mount

  const handleReuse = async (config: GenerateConfig) => {
    if (!reuseEmailId) return;
    
    console.log("Adapting email creative for new product:", config);
    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationStatus("Preparing...");
    setLastConfig(config);

    try {
      const product = mockProducts.find((p) => p.id === config.productId);
      if (!product) {
        console.error("Product not found");
        setIsGenerating(false);
        return;
      }

      // Use displayName for emails if available, otherwise use full name
      const productName = product.displayName || product.name;
      const offerLink = product.offerLink || `https://example.com/${productName.toLowerCase().replace(/\s+/g, '-')}`;

      // Step 1: Audit the product
      setGenerationProgress(10);
      setGenerationStatus("Analyzing new product details...");
      
      const auditResponse = await fetch("/api/audit-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          offerLink, 
          productName,
          manualContent: product.manualContent 
        }),
        signal: abortControllerRef.current?.signal,
      });

      const auditData = await auditResponse.json();
      
      if (!auditData.success || auditData.productDetails?.error) {
        toast({
          title: "Error",
          description: "Unable to extract product details. Please make sure the product has manual content filled in.",
          variant: "destructive",
        });
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");
        return;
      }

      // Step 2: Adapt the email creative
      setGenerationProgress(40);
      setGenerationStatus("Adapting creative for new product...");
      
      const reuseResponse = await fetch("/api/reuse-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId: reuseEmailId,
          productName,
          productDetails: auditData.productDetails,
          offerType: product.offerType,
          offerLink,
        }),
      });

      setGenerationProgress(90);
      setGenerationStatus("Finalizing...");

      const reuseData = await reuseResponse.json();

      if (!reuseData.success || !reuseData.email) {
        console.error("Failed to adapt email");
        toast({
          title: "Error",
          description: "Failed to adapt email creative. Please try again.",
          variant: "destructive",
        });
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");
        return;
      }

      // Display the single adapted email
      const adaptedEmail: EmailVariation = {
        id: "1",
        subjects: reuseData.email.subjects || [],
        body: reuseData.email.body || "",
        htmlBody: convertBodyToHtml(reuseData.email.body || ""),
      };

      setGenerationProgress(100);
      setGenerationStatus("Complete!");
      
      setEmailVariations([adaptedEmail]);
      setActiveVariation("1");
      
      toast({
        title: "Success",
        description: "Email creative adapted for new product",
      });
      
      setTimeout(() => {
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");
      }, 500);
    } catch (error) {
      console.error("Error adapting email:", error);
      toast({
        title: "Error",
        description: "An error occurred while adapting the email. Please try again.",
        variant: "destructive",
      });
      setIsGenerating(false);
      setGenerationProgress(0);
      setGenerationStatus("");
    }
  };

  const handleCancel = () => {
    // Abort any ongoing fetch requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // Clear any progress intervals
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    
    // Reset state
    setIsGenerating(false);
    setGenerationProgress(0);
    setGenerationStatus("");
    
    // Clear pending session
    localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
    localStorage.removeItem(STORAGE_KEYS.pendingSessionId + '_timestamp');
    
    toast({
      title: "Generation Cancelled",
      description: "Email generation has been stopped. You can start a new generation anytime.",
    });
  };

  const handleGenerate = async (config: GenerateConfig) => {
    // If in reuse mode, use handleReuse instead
    if (reuseEmailId) {
      return handleReuse(config);
    }

    console.log("Generating 5 email variations with config:", config);
    
    // Clear any old sessionId first to prevent conflicts
    const oldSessionId = localStorage.getItem(STORAGE_KEYS.pendingSessionId);
    if (oldSessionId) {
      console.log("Clearing old sessionId before new generation:", oldSessionId);
      localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
    }
    
    // Create new AbortController for this generation
    abortControllerRef.current = new AbortController();
    
    // Generate sessionId on frontend for recovery
    const sessionId = crypto.randomUUID();
    
    // Save sessionId immediately for recovery (BEFORE generation starts)
    try {
      localStorage.setItem(STORAGE_KEYS.pendingSessionId, sessionId);
      localStorage.setItem(STORAGE_KEYS.pendingSessionId + '_timestamp', Date.now().toString());
      console.log("Saved sessionId for recovery:", sessionId);
    } catch (e) {
      console.error("Failed to save sessionId to localStorage:", e);
    }
    
    // Clear old emails immediately when generation starts
    setEmailVariations(defaultEmailVariations);
    setActiveVariation("1");
    
    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationStatus("Preparing...");
    setGenerationErrors({}); // Clear previous errors
    setLastConfig(config); // Remember the config for regeneration

    try {
      const product = mockProducts.find((p) => p.id === config.productId);
      if (!product) {
        console.error("Product not found");
        setIsGenerating(false);
        return;
      }

      // Use displayName for emails if available, otherwise use full name
      const productName = product.displayName || product.name;
      const offerLink = product.offerLink || `https://example.com/${productName.toLowerCase().replace(/\s+/g, '-')}`;

      console.log(`Step 1: Auditing product link: ${offerLink}`);

      // Step 1: Audit the product link to extract real details
      setGenerationProgress(10);
      setGenerationStatus("Analyzing product details...");
      
      const auditResponse = await fetch("/api/audit-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          offerLink, 
          productName,
          manualContent: product.manualContent 
        }),
        signal: abortControllerRef.current?.signal,
      });

      const auditData = await auditResponse.json();
      
      if (!auditData.success) {
        console.error("Failed to audit product");
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");
        return;
      }

      console.log("Product details extracted:", auditData.productDetails);

      // Check if audit failed or returned an error
      if (auditData.productDetails?.error) {
        console.error("Product audit returned error:", auditData.productDetails.error);
        alert("Unable to extract product details. Please make sure the product has manual content filled in.");
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");
        return;
      }

      // Step 2: Generate emails using the real product details
      setGenerationProgress(30);
      setGenerationStatus("AI is writing your emails...");
      
      // Start simulating progress during AI generation (30% -> 95% continuously)
      let currentProgress = 30;
      progressIntervalRef.current = setInterval(() => {
        currentProgress += 0.5; // Increment by 0.5% every second (continuously climb to 95%)
        if (currentProgress < 95) {
          setGenerationProgress(Math.floor(currentProgress));
        } else {
          setGenerationProgress(95); // Hold at 95%
        }
      }, 1000); // Update every second
      
      const generateResponse = await fetch("/api/generate-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId, // Pass the frontend-generated sessionId
          productId: config.productId,
          productName,
          productDetails: auditData.productDetails,
          manualContent: product.manualContent,
          toneAngle: config.toneAngle,
          customTone: config.customTone,
          offerType: product.offerType,
          offerLink,
        }),
        signal: abortControllerRef.current?.signal,
      });

      // Clear the progress interval once API call completes
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      // Progress should be at 95% by now, just ensure it's set
      setGenerationProgress(95);
      setGenerationStatus("Finalizing emails...");

      const generateData = await generateResponse.json();

      if (!generateData.success) {
        console.error("Failed to generate emails");
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");
        return;
      }

      // SessionId was already saved at the start of generation

      console.log("Claude Sonnet 4.5 generated emails:", generateData.claudeSonnet45Variations);
      console.log("Claude Sonnet 4 generated emails:", generateData.claudeVariations);
      
      // Capture any errors from the generation
      setGenerationErrors(generateData.errors || {});

      // Format Claude Sonnet 4.5 variations
      const claudeSonnet45Variations: EmailVariation[] = (generateData.claudeSonnet45Variations || []).map((v: any, idx: number) => ({
        id: `claude-sonnet-4.5-${idx + 1}`,
        subjects: v.subjects || [],
        body: v.body || "",
        htmlBody: convertBodyToHtml(v.body || ""),
        aiProvider: 'claude-sonnet-4.5' as const,
      }));

      // Format Claude Sonnet 4 variations
      const claudeVariations: EmailVariation[] = (generateData.claudeVariations || []).map((v: any, idx: number) => ({
        id: `claude-sonnet-4-${idx + 1}`,
        subjects: v.subjects || [],
        body: v.body || "",
        htmlBody: convertBodyToHtml(v.body || ""),
        aiProvider: 'claude-sonnet-4' as const,
      }));

      // Combine all variations
      const variations: EmailVariation[] = [...claudeSonnet45Variations, ...claudeVariations];

      setGenerationProgress(100);
      setGenerationStatus("Complete!");
      
      setEmailVariations(variations);
      // Set active variation to first Claude variant if available, otherwise first GPT variant
      setActiveVariation(claudeVariations[0]?.id || variations[0]?.id || "1");
      
      // Set Claude section open and GPT section collapsed
      setClaudeSectionOpen(true);
      setGptSectionOpen(false);
      
      // Show completion toast with navigation action
      const totalEmails = variations.length;
      toast({
        title: "Generation Complete",
        description: `Generated ${totalEmails} email variation${totalEmails !== 1 ? 's' : ''}`,
        action: (
          <ToastAction altText="View Emails" onClick={() => setLocation('/email-generator')}>
            View Emails
          </ToastAction>
        ),
      });
      
      // DON'T clear pendingSessionId here - keep it for recovery if user navigates away
      // It will be cleared when user navigates away (component unmount) or when recovery completes
      
      // Reset after a brief delay
      setTimeout(() => {
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");
      }, 500);
    } catch (error: any) {
      // Check if this was a user cancellation
      if (error.name === 'AbortError') {
        console.log("Generation was cancelled by user");
        return; // Don't show error toast for user cancellations
      }
      
      console.error("Error generating emails:", error);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setIsGenerating(false);
      setGenerationProgress(0);
      setGenerationStatus("");
      
      toast({
        title: "Generation Error",
        description: "An error occurred during generation. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Old mock functionality preserved as fallback (not used anymore)
  const handleGenerateMock = (config: GenerateConfig) => {
    const product = mockProducts.find((p) => p.id === config.productId);
    const productName = product?.name || "Product";

      let variations: EmailVariation[] = [];

      // Generate different variations based on selected tone/angle
      if (config.toneAngle === "legendary-copywriters") {
        variations = [
          {
            id: "1",
            subjects: [
              `The "${productName}" Secret Nobody Talks About...`,
              `What Most People Don't Know About ${productName}`,
              `${productName}: The Untold Story`
            ],
            body: `Dear Friend,

Most people will NEVER discover what I'm about to tell you about ${productName}.

There's a reason the smart ones quietly stock up while everyone else makes excuses.

They understand something you're about to learn.

Discover what they know before it's too late.

To your success,
The Team

P.S. - Get yours now while inventory lasts.`,
            htmlBody: `<div style="font-family: Georgia, serif; line-height: 1.8; color: #000;"><p><strong>Dear Friend,</strong></p><p>Most people will <strong><em>never</em></strong> discover what I'm about to tell you about <strong>${productName}</strong>.</p><p>There's a reason the smart ones <em>quietly</em> stock up while everyone else makes excuses.</p><p>They understand something you're about to learn.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Discover what they know</a> before it's too late.</p><p>To your success,<br>The Team</p><p style="font-style: italic; color: #666;">P.S. - <a href="#" style="color: #0066cc; text-decoration: underline;">Get yours now</a> while inventory lasts.</p></div>`,
          },
          {
            id: "2",
            subjects: [
              `How A Simple ${productName} Changed Everything`,
              `${productName}: The Game Changer`,
              `This ${productName} Story Will Surprise You`
            ],
            body: `Listen,

I wasn't planning to write today.

But something happened I had to share.

A customer called yesterday. Said ${productName} changed their entire approach.

I'm not one for hyperbole. But when someone says something works THIS well, I pay attention.

You should too.

See for yourself why everyone's talking about it.

Yours truly,
The Team

P.S. - Get it now before the price increase.`,
            htmlBody: `<div style="font-family: Georgia, serif;  line-height: 1.8; color: #000;"><p><strong>Listen,</strong></p><p>I wasn't planning to write today.</p><p>But something happened I had to share.</p><p>A customer called yesterday. Said <strong>${productName}</strong> changed their <strong><u>entire approach</u></strong>.</p><p>I'm not one for hyperbole. But when someone says something works <strong>THIS</strong> well, I pay attention.</p><p><u>You should too</u>.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">See for yourself</a> why everyone's talking about it.</p><p>Yours truly,<br>The Team</p><p style="font-style: italic; color: #666;">P.S. - <a href="#" style="color: #0066cc; text-decoration: underline;">Get it now</a> before the price increase.</p></div>`,
          },
          {
            id: "3",
            subjects: [
              `WARNING: ${productName} Selling Out Fast`,
              `${productName} - Final Warning`,
              `Last Chance for ${productName}`
            ],
            body: `URGENT:

${productName} inventory is dropping fast.

Once they're gone, they're gone. No rain checks. No waiting lists. No exceptions.

If you've been on the fence, NOW is the time.

Secure yours before the deadline.

In 24 hours, this opportunity disappears.

Don't say I didn't warn you,
The Team`,
            htmlBody: `<div style="font-family: Georgia, serif;  line-height: 1.8; color: #000;"><p style="color: #dc2626; font-weight: bold; text-decoration: underline;">URGENT:</p><p><strong>${productName}</strong> inventory is dropping <strong><em>fast</em></strong>.</p><p>Once they're gone, they're <u>gone</u>. No rain checks. No waiting lists. <strong>No exceptions</strong>.</p><p>If you've been on the fence, <strong>NOW</strong> is the time.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Secure yours</a> before the deadline.</p><p>In <strong>24 hours</strong>, this opportunity <em>disappears</em>.</p><p>Don't say I didn't warn you,<br>The Team</p></div>`,
          },
          {
            id: "4",
            subjects: [
              `Why ${productName} Works When Nothing Else Does`,
              `${productName}: The Real Deal`,
              `Finally, A ${productName} That Actually Works`
            ],
            body: `Here's what nobody tells you:

Most products in this category are smoke and mirrors.

${productName}? Different story.

We built this on a simple principle: It works, or you don't pay.

No theories. No marketing. Just results.

That's what you get when you start now.

Best regards,
The Team

P.S. - Still skeptical? Read what customers say.`,
            htmlBody: `<div style="font-family: Georgia, serif;  line-height: 1.8; color: #000;"><p><strong>Here's what nobody tells you:</strong></p><p>Most products in this category are <em>smoke and mirrors</em>.</p><p><strong>${productName}</strong>? <u>Different story</u>.</p><p>We built this on a simple principle: <strong>It works, or you don't pay</strong>.</p><p>No theories. No marketing. <strong><em>Just results</em></strong>.</p><p>That's what you get when you <a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">start now</a>.</p><p>Best regards,<br>The Team</p><p style="font-style: italic; color: #666;">P.S. - Still skeptical? <a href="#" style="color: #0066cc; text-decoration: underline;">Read what customers say</a>.</p></div>`,
          },
          {
            id: "5",
            subjects: [
              `${productName}: The Truth They Don't Want You To Know`,
              `Breaking: ${productName} Industry Secret Exposed`,
              `They Don't Want You To Know About ${productName}`
            ],
            body: `I'm going to get in trouble for this.

But you deserve the truth about ${productName}.

The big guys don't want you knowing this. It threatens their entire business model.

That's why they keep it quiet.

But I'm breaking ranks. You have a right to know.

Here's the full story they've been hiding.

Spread the word,
The Team

P.S. - Get this while you can. Won't be available forever.`,
            htmlBody: `<div style="font-family: Georgia, serif;  line-height: 1.8; color: #000;"><p style="font-style: italic;">I'm going to get in trouble for this.</p><p>But you deserve <u>the truth</u> about <strong>${productName}</strong>.</p><p>The big guys <strong><em>don't want you knowing this</em></strong>. It threatens their <u>entire business model</u>.</p><p>That's why they keep it quiet.</p><p>But I'm breaking ranks. You have a <strong>right to know</strong>.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Here's the full story</a> they've been hiding.</p><p>Spread the word,<br>The Team</p><p style="font-style: italic; color: #666;">P.S. - <a href="#" style="color: #0066cc; text-decoration: underline;">Get this while you can</a>. Won't be available forever.</p></div>`,
          },
        ];
      } else if (config.toneAngle === "national-brands") {
        variations = [
          {
            id: "1",
            subjects: [
              `Built for the Wild: ${productName}`,
              `${productName}: Gear That Never Quits`,
              `Ready for Anything: ${productName}`
            ],
            body: `Out here, your gear isn't just equipment.

It's the difference between a good day and a bad one.

That's why we built ${productName} to handle whatever nature throws at you.

Tested in the harshest conditions. Trusted by those who demand the best.

Because when you're miles from anywhere, average won't cut it.

Gear up with equipment that's as tough as you are.

Stay prepared,
The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><p><strong>Out here, your gear isn't just equipment.</strong></p><p>It's the difference between a <em>good day</em> and a <em>bad one</em>.</p><p>That's why we built <strong>${productName}</strong> to handle <u>whatever nature throws at you</u>.</p><p>Tested in the <strong>harshest conditions</strong>. Trusted by those who demand <em>the best</em>.</p><p>Because when you're miles from anywhere, <strong>average won't cut it</strong>.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Gear up</a> with equipment that's as tough as you are.</p><p>Stay prepared,<br>The Team</p></div>`,
          },
          {
            id: "2",
            subjects: [
              `Heritage Meets Performance: ${productName}`,
              `${productName}: American-Made Excellence`,
              `Craftsmanship You Can Trust: ${productName}`
            ],
            body: `Since day one, we've stood for quality that lasts.

No shortcuts. No compromises.

${productName} represents everything we believe in: American-made toughness, field-tested reliability, and the kind of craftsmanship that gets passed down through generations.

This isn't just gear. It's a statement about who you are.

Experience the difference that true quality makes.

Respectfully,
The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><p><strong>Since day one, we've stood for quality that lasts.</strong></p><p><strong>No shortcuts. No compromises.</strong></p><p><strong>${productName}</strong> represents everything we believe in: <em>American-made toughness</em>, <em>field-tested reliability</em>, and the kind of <u>craftsmanship that gets passed down through generations</u>.</p><p>This isn't just gear. It's a <strong>statement about who you are</strong>.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Experience the difference</a> that true quality makes.</p><p>Respectfully,<br>The Team</p></div>`,
          },
          {
            id: "3",
            subjects: [
              `Proven in the Field: ${productName}`,
              `${productName}: Battle-Tested Performance`,
              `Real Gear for Real Conditions: ${productName}`
            ],
            body: `Talk is cheap.

That's why we let our gear do the talking.

${productName} has been tested by real outdoorsmen in real conditions. From the mountains to the backcountry, it delivers.

No marketing fluff. Just proven performance when it matters most.

Ready when you are.

Shop now and see why professionals choose us.

The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><p><strong>Talk is cheap.</strong></p><p>That's why we let our gear do the talking.</p><p>${productName} has been tested by real outdoorsmen in real conditions. From the mountains to the backcountry, it delivers.</p><p>No marketing fluff. Just proven performance when it matters most.</p><p>Ready when you are.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Shop now</a> and see why professionals choose us.</p><p>The Team</p></div>`,
          },
          {
            id: "4",
            subjects: [
              `Your Rights, Your Gear: ${productName}`,
              `${productName}: Defend Your Freedom`,
              `Stand Ready with ${productName}`
            ],
            body: `We believe in your right to be prepared.

To protect what matters. To stand ready.

That's why ${productName} is built to the highest standards - because your freedom depends on gear you can trust.

Join thousands of patriots who refuse to compromise on quality.

Defend your freedom with equipment built for the task.

Stand strong,
The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><p><strong>We believe in your right to be prepared.</strong></p><p>To protect what matters. To stand ready.</p><p>That's why ${productName} is built to the highest standards - because your freedom depends on gear you can trust.</p><p>Join thousands of patriots who refuse to compromise on quality.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Defend your freedom</a> with equipment built for the task.</p><p>Stand strong,<br>The Team</p></div>`,
          },
          {
            id: "5",
            subjects: [
              `Adventure Awaits: ${productName}`,
              `${productName}: Your Next Journey Starts Here`,
              `Go Further with ${productName}`
            ],
            body: `The best adventures happen when you're properly equipped.

${productName} gives you the confidence to explore further, push harder, and discover what's possible.

Built for those who don't just talk about adventure - they live it.

Your next journey starts here.

Explore more and discover your potential.

See you out there,
The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><p><strong>The best adventures happen when you're properly equipped.</strong></p><p>${productName} gives you the confidence to explore further, push harder, and discover what's possible.</p><p>Built for those who don't just talk about adventure - they live it.</p><p>Your next journey starts here.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Explore more</a> and discover your potential.</p><p>See you out there,<br>The Team</p></div>`,
          },
        ];
      } else if (config.toneAngle === "current-events") {
        // NOTE: In production, these should reference ACTUAL current events pulled from news APIs
        // For now, demonstrating the concept with realistic examples
        variations = [
          {
            id: "1",
            subjects: [
              `Government Shutdown? Here's What Smart People Are Doing...`,
              `While Everyone Panics About the Shutdown, Do This Instead`,
              `The Shutdown Nobody's Talking About - ${productName}`
            ],
            body: `With the government shutdown chaos, most people panic.

Smart people do something different.

They secure ${productName} NOW - before everyone else figures out what's coming.

When things get uncertain, there's opportunity for those paying attention.

Don't wait for everyone to catch up. Get ahead now.

Stay prepared,
The Team

P.S. - Stock drops during events like this. Secure yours today.`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><p>With the <strong>government shutdown chaos</strong>, most people panic.</p><p>Smart people do something <em>different</em>.</p><p>They secure <strong>${productName}</strong> <u>NOW</u> - before everyone else figures out what's coming.</p><p>When things get uncertain, there's opportunity for those paying attention.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Don't wait for everyone to catch up</a>. Get ahead now.</p><p>Stay prepared,<br>The Team</p><p style="font-style: italic; color: #666;">P.S. - Stock drops during events like this. <a href="#" style="color: #0066cc; text-decoration: underline;">Secure yours today</a>.</p></div>`,
          },
          {
            id: "2",
            subjects: [
              `The AWS Outage Just Proved Something Important...`,
              `If the AWS Outage Taught Us Anything...`,
              `${productName} + The AWS Lesson Everyone Missed`
            ],
            body: `Yesterday's AWS outage reminded us:

You can't rely on systems you don't control.

Thousands of businesses went dark. Millions lost access.

But those with backup plans? Barely noticed.

That's why ${productName} matters now.

When the next outage hits (and it will), you'll either be prepared or not.

Learn from yesterday. Get protected today.

Stay resilient,
The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><p><strong>Yesterday's AWS outage</strong> reminded us:</p><p><em>You can't rely on systems you don't control.</em></p><p>Thousands of businesses went dark. Millions lost access.</p><p>But those with <strong>backup plans</strong>? Barely noticed.</p><p>That's why <strong>${productName}</strong> matters now.</p><p>When the next outage hits (and it <u>will</u>), you'll either be prepared or not.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Learn from yesterday</a>. Get protected today.</p><p>Stay resilient,<br>The Team</p></div>`,
          },
          {
            id: "3",
            subjects: [
              `Supply Chain Crisis: The ${productName} Problem`,
              `Before Supply Issues Hit ${productName}...`,
              `Inventory Warning: ${productName} Stock Alert`
            ],
            body: `You're seeing it everywhere.

Supply chain disruptions. Shipping delays. Empty shelves.

${productName} hasn't been affected yet. But our suppliers warn it's only a matter of time.

Once our current inventory is gone, we can't promise when the next shipment arrives.

Could be weeks. Could be months.

Secure yours while available.

Best,
The Team

P.S. - We're seeing 3x normal order volume. Don't wait.`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; background: #fef3c7; padding: 20px; border-left: 4px solid #f59e0b;"><p><strong>You're seeing it everywhere.</strong></p><p>Supply chain disruptions. Shipping delays. <strong>Empty shelves</strong>.</p><p><strong>${productName}</strong> hasn't been affected <u>yet</u>. But our suppliers warn it's only a matter of time.</p><p>Once our current inventory is gone, we can't promise when the next shipment arrives.</p><p><em>Could be weeks. Could be months.</em></p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Secure yours</a> while available.</p><p>Best,<br>The Team</p><p style="font-style: italic; color: #78350f; margin-top: 12px;">P.S. - We're seeing <strong>3x normal order volume</strong>. <a href="#" style="color: #0066cc; text-decoration: underline;">Don't wait</a>.</p></div>`,
          },
          {
            id: "4",
            subjects: [
              `Everyone's Talking About [Recent Event] - Here's What They're Missing`,
              `The [Breaking News] Nobody Saw Coming`,
              `${productName}: Your Hedge Against What's Next`
            ],
            body: `Turn on the news lately?

Everything's changing fast.

While everyone argues about what it means, smart people take action.

They're not waiting for things to "settle down." They position themselves NOW for what's next.

${productName} is part of that strategy.

When uncertainty is the only certainty, preparation is your edge.

Get positioned today.

The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><p><strong>Turn on the news lately?</strong></p><p>Everything's changing <em>fast</em>.</p><p>While everyone argues about what it means, <strong>smart people take action</strong>.</p><p>They're not waiting for things to "settle down." They position themselves <u>NOW</u> for what's next.</p><p><strong>${productName}</strong> is part of that strategy.</p><p>When uncertainty is the only certainty, <strong>preparation is your edge</strong>.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Get positioned today</a>.</p><p>The Team</p></div>`,
          },
          {
            id: "5",
            subjects: [
              `What the Latest [Event] Means for ${productName}`,
              `Trending Now: ${productName} Surge Explained`,
              `Why Everyone's Suddenly Buying ${productName}`
            ],
            body: `In the last 48 hours, ${productName} orders spiked 300%.

Why?

People are connecting the dots between recent events and what they need.

Whether it's economic news, tech disruptions, or geopolitical shifts - smart people know waiting is the riskiest move.

They take action while everyone else "thinks about it."

Join them before it's too late.

The Team

P.S. - Current lead time: 2-3 days. Could change fast.`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; border-top: 3px solid #dc2626; padding-top: 16px;"><p>In the last 48 hours, <strong>${productName}</strong> orders <strong style="color: #dc2626;">spiked 300%</strong>.</p><p><strong>Why?</strong></p><p>People are connecting the dots between recent events and what they need.</p><p>Whether it's economic news, tech disruptions, or geopolitical shifts - smart people know <em>waiting is the riskiest move</em>.</p><p>They take action while everyone else "thinks about it."</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Join them</a> before it's too late.</p><p>The Team</p><p style="font-style: italic; color: #666; border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 12px;">P.S. - Current lead time: 2-3 days. Could change fast.</p></div>`,
          },
        ];
      } else if (config.toneAngle === "you-won") {
        variations = [
          {
            id: "1",
            subjects: [
              `🏆 WINNER ALERT: You've Won ${productName}!`,
              `Congratulations! ${productName} Winner Selected`,
              `You're Our Lucky ${productName} Winner!`
            ],
            body: `CONGRATULATIONS!

You've been randomly selected as our latest winner!

Your prize: Exclusive access to ${productName} at our special winner's price.

This isn't a drill. You actually won.

But here's the catch - you have 48 hours to claim your prize before we select another winner.

Congratulations again,
The Team

P.S. - Winners who act fast get FREE expedited shipping! Claim now.`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; background: #fef3c7; padding: 20px; border-radius: 8px;"><h2 style="color: #92400e; text-align: center;">🏆 CONGRATULATIONS! 🏆</h2><p style="font-weight: bold; color: #78350f;">You've been randomly selected as our latest winner!</p><p>Your prize: Exclusive access to ${productName} at our special winner's price.</p><p>This isn't a drill. You actually won.</p><p>But here's the catch - you have 48 hours to <a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">claim your prize</a> before we select another winner.</p><p>Congratulations again,<br>The Team</p><p style="font-style: italic; color: #78350f; border-top: 2px solid #fbbf24; padding-top: 12px; margin-top: 12px;">P.S. - Winners who act fast get FREE expedited shipping! <a href="#" style="color: #0066cc; text-decoration: underline;">Claim now</a>.</p></div>`,
          },
          {
            id: "2",
            subjects: [
              `[CONFIRMED] You're Our ${productName} Winner!`,
              `Winner Notification: ${productName} Reserved for You`,
              `OFFICIAL: You Won ${productName}!`
            ],
            body: `Dear Winner,

We're thrilled to confirm: YOU WON!

Your name was drawn from thousands of entries, and you're now entitled to receive ${productName} at an unbeatable winner's discount.

No gimmicks. No catches. Just pure winner status.

Verify your win and claim your reward before the deadline.

Proudly,
The Team

Winner ID: #${Math.floor(Math.random() * 10000)}`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; border: 3px solid #fbbf24; padding: 20px;"><p style="background: #fbbf24; color: #000; padding: 8px 16px; font-weight: bold; text-align: center; margin: -20px -20px 20px -20px;">✓ WINNER CONFIRMED</p><p><strong>Dear Winner,</strong></p><p>We're thrilled to confirm: <strong style="color: #dc2626;">YOU WON!</strong></p><p>Your name was drawn from thousands of entries, and you're now entitled to receive ${productName} at an unbeatable winner's discount.</p><p>No gimmicks. No catches. Just pure winner status.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Verify your win</a> and claim your reward before the deadline.</p><p>Proudly,<br>The Team</p><p style="font-size: 12px; color: #666; border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 12px;">Winner ID: #${Math.floor(Math.random() * 10000)}</p></div>`,
          },
          {
            id: "3",
            subjects: [
              `YOU WON! ${productName} - Claim Within 24hrs`,
              `Winner Alert: ${productName} Prize Waiting`,
              `🎉 ${productName} Winner - Action Required`
            ],
            body: `WINNER NOTIFICATION

🎉 CONGRATULATIONS! 🎉

You are the confirmed winner of ${productName}!

We randomly selected your email from our database, and you've hit the jackpot.

Here's what you won:
• Exclusive winner's pricing
• Priority processing
• Free premium shipping

IMPORTANT: This offer expires in 24 hours. Claim now to secure your prize.

Celebrate responsibly,
The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;"><h3 style="margin: 0; color: white;">WINNER NOTIFICATION</h3><p style="font-size: 28px; margin: 10px 0;">🎉 CONGRATULATIONS! 🎉</p></div><div style="padding: 20px; background: #fafafa;"><p style="font-weight: bold;">You are the confirmed winner of ${productName}!</p><p>We randomly selected your email from our database, and you've hit the jackpot.</p><p><strong>Here's what you won:</strong></p><ul><li>Exclusive winner's pricing</li><li>Priority processing</li><li>Free premium shipping</li></ul><p style="color: #dc2626; font-weight: bold;">IMPORTANT: This offer expires in 24 hours. <a href="#" style="color: #0066cc; text-decoration: underline;">Claim now</a> to secure your prize.</p><p>Celebrate responsibly,<br>The Team</p></div></div>`,
          },
          {
            id: "4",
            subjects: [
              `Special Winner Access: ${productName} Reserved`,
              `${productName} Winner's Vault - Your Access`,
              `You've Been Chosen for ${productName}`
            ],
            body: `You've Been Selected!

Out of everyone on our list, YOU were chosen.

Your ${productName} is now reserved in our winner's vault, waiting for you to claim it.

This is a one-time opportunity. Miss it, and it goes to the next person in line.

Winner benefits:
→ 50% off standard pricing
→ Lifetime warranty upgrade
→ VIP customer status

Reserved for 72 hours only.

You earned this,
The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; border: 2px solid #7c3aed; padding: 20px; border-radius: 8px;"><h3 style="color: #7c3aed; text-align: center;">✨ You've Been Selected! ✨</h3><p>Out of everyone on our list, <strong>YOU</strong> were chosen.</p><p>Your ${productName} is now reserved in our winner's vault, waiting for you to <a href="#" style="color: #0066cc; text-decoration: underline;">claim it</a>.</p><p>This is a one-time opportunity. Miss it, and it goes to the next person in line.</p><div style="background: #f3f4f6; padding: 16px; border-radius: 6px; margin: 20px 0;"><p style="margin: 0 0 8px 0; font-weight: bold;">Winner benefits:</p><ul style="margin: 0;"><li>50% off standard pricing</li><li>Lifetime warranty upgrade</li><li>VIP customer status</li></ul></div><p style="color: #dc2626; font-weight: bold;">Reserved for 72 hours only.</p><p>You earned this,<br>The Team</p></div>`,
          },
          {
            id: "5",
            subjects: [
              `🎁 SURPRISE! ${productName} Winner Announcement`,
              `${productName} Winner - Limited Time to Claim`,
              `You're a ${productName} Winner!`
            ],
            body: `This is not a test.

You are officially our newest ${productName} winner!

We're celebrating our milestone, and you're one of the lucky few selected to receive special winner pricing.

What makes this special? While others pay full price, you get immediate winner access - but only if you act within the next 48 hours.

After that? This opportunity vanishes.

Enjoy your win,
The Team

P.S. - Your confirmation code: WIN${Math.floor(Math.random() * 1000)}`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; background: #fef3c7; padding: 20px; border-radius: 8px;"><div style="text-align: center; margin-bottom: 20px;"><span style="font-size: 48px;">🎁</span><h3 style="color: #92400e; margin: 10px 0;">SURPRISE!</h3><p style="font-weight: bold; color: #78350f; margin: 0;">${productName} Winner Announcement</p></div><p style="font-weight: bold;">This is not a test.</p><p>You are officially our newest ${productName} winner!</p><p>We're celebrating our milestone, and you're one of the lucky few selected to receive special winner pricing.</p><p>What makes this special? While others pay full price, you get immediate winner access - but only if you <a href="#" style="color: #0066cc; text-decoration: underline;">act within the next 48 hours</a>.</p><p>After that? This opportunity vanishes.</p><p>Enjoy your win,<br>The Team</p><p style="font-size: 12px; color: #78350f; border-top: 2px solid #fbbf24; padding-top: 12px; margin-top: 12px;">P.S. - Your confirmation code: WIN${Math.floor(Math.random() * 1000)}</p></div>`,
          },
        ];
      } else if (config.toneAngle === "try-something-new") {
        variations = [
          {
            id: "1",
            subjects: [
              `[CASE STUDY] How ${productName} Saved $10,000`,
              `Real Results: ${productName} Success Story`,
              `Before & After: ${productName} Transformation`
            ],
            body: `CASE STUDY #47

Meet Sarah. She was skeptical about ${productName} at first.

"I'd tried everything," she told us. "Nothing worked."

Then she discovered ${productName}.

Within 30 days, everything changed. Read her full story here.

Today, she's telling everyone who will listen.

Could you be next? Find out here.

The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; border-left: 4px solid #7c3aed; padding-left: 20px;"><p style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px;">CASE STUDY #47</p><p><strong>Meet Sarah.</strong> She was skeptical about ${productName} at first.</p><p>"I'd tried everything," she told us. "Nothing worked."</p><p>Then she discovered ${productName}.</p><p>Within 30 days, everything changed. <a href="#" style="color: #0066cc; text-decoration: underline;">Read her full story here</a>.</p><p>Today, she's telling everyone who will listen.</p><p>Could you be next? <a href="#" style="color: #0066cc; text-decoration: underline;">Find out here</a>.</p><p>The Team</p></div>`,
          },
          {
            id: "2",
            subjects: [
              `Quick Question About ${productName}...`,
              `Curious About ${productName}?`,
              `1 Simple Question`
            ],
            body: `Quick question:

If you could solve your biggest problem in the next 7 days with ${productName}, would you try it?

I'm not asking you to commit to anything. Just answer honestly.

If YES: Click here and I'll show you exactly how.

If NO: That's okay too. You can learn more here and decide later.

Either way, you have nothing to lose.

The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000;"><p style="font-weight: bold;">Quick question:</p><p>If you could solve your biggest problem in the next 7 days with ${productName}, would you try it?</p><p>I'm not asking you to commit to anything. Just answer honestly.</p><p><strong>If YES:</strong> <a href="#" style="color: #0066cc; text-decoration: underline;">Click here</a> and I'll show you exactly how.</p><p><strong>If NO:</strong> That's okay too. You can <a href="#" style="color: #0066cc; text-decoration: underline;">learn more here</a> and decide later.</p><p>Either way, you have nothing to lose.</p><p>The Team</p></div>`,
          },
          {
            id: "3",
            subjects: [
              `[BREAKING NEWS] ${productName} Discovery`,
              `Scientists Shocked by ${productName} Results`,
              `${productName}: What Experts Are Saying`
            ],
            body: `BREAKING:

A new study just revealed something shocking about ${productName}.

Researchers didn't expect these results. But the data doesn't lie.

The findings could change everything we thought we knew.

See the full report before it goes viral.

This is exactly why early adopters are already seeing incredible results.

Get started now and join them.

The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; background: #f3f4f6; padding: 20px; border-top: 3px solid #dc2626;"><p style="color: #dc2626; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">BREAKING:</p><p>A new study just revealed something shocking about ${productName}.</p><p>Researchers didn't expect these results. But the data doesn't lie.</p><p>The findings could change everything we thought we knew.</p><p><a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">See the full report</a> before it goes viral.</p><p>This is exactly why early adopters are already seeing incredible results.</p><p><a href="#" style="color: #0066cc; text-decoration: underline;">Get started now</a> and join them.</p><p>The Team</p></div>`,
          },
          {
            id: "4",
            subjects: [
              `The ${productName} Quiz (30 seconds)`,
              `Are You a Good Fit for ${productName}?`,
              `Take This ${productName} Quiz`
            ],
            body: `Is ${productName} right for you?

Take this 30-second quiz to find out.

Question 1: Do you want better results?
Question 2: Are you willing to try something new?
Question 3: Can you commit 5 minutes per day?

If you answered YES to all three, ${productName} is perfect for you.

If you answered NO to any question, you might want to learn more first.

Either way, you'll have your answer.

The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; border: 2px dashed #7c3aed; padding: 20px;"><p style="font-weight: bold; color: #7c3aed;">Is ${productName} right for you?</p><p>Take this 30-second quiz to find out.</p><p><strong>Question 1:</strong> Do you want better results?<br><strong>Question 2:</strong> Are you willing to try something new?<br><strong>Question 3:</strong> Can you commit 5 minutes per day?</p><p>If you answered <strong>YES</strong> to all three, <a href="#" style="color: #0066cc; text-decoration: underline;">${productName} is perfect for you</a>.</p><p>If you answered <strong>NO</strong> to any question, you might want to <a href="#" style="color: #0066cc; text-decoration: underline;">learn more first</a>.</p><p>Either way, you'll have your answer.</p><p>The Team</p></div>`,
          },
          {
            id: "5",
            subjects: [
              `${productName} - 72 Hour Challenge`,
              `Can You Handle the ${productName} Challenge?`,
              `I Dare You to Try ${productName}`
            ],
            body: `I'm issuing a challenge.

Use ${productName} for exactly 72 hours.

If you don't see results, keep it anyway. No charge.

But here's what I think will happen: You'll see such amazing results that you'll wonder why you waited so long.

Ready to accept? Start your 72-hour challenge now.

Not ready? No problem. Learn more about the challenge first.

The ball's in your court.

The Team`,
            htmlBody: `<div style="font-family: Arial, sans-serif;  line-height: 1.8; color: #000; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 20px; border-radius: 8px;"><p style="font-weight: bold; font-size: 18px; color: #92400e;">I'm issuing a challenge.</p><p>Use ${productName} for exactly 72 hours.</p><p>If you don't see results, keep it anyway. No charge.</p><p>But here's what I think will happen: You'll see such amazing results that you'll wonder why you waited so long.</p><p>Ready to accept? <a href="#" style="color: #0066cc; text-decoration: underline; font-weight: bold;">Start your 72-hour challenge</a> now.</p><p>Not ready? No problem. <a href="#" style="color: #0066cc; text-decoration: underline;">Learn more about the challenge</a> first.</p><p style="font-weight: bold;">The ball's in your court.</p><p>The Team</p></div>`,
          },
        ];
      } else {
        // Default/high-performing
        variations = [
          {
            id: "1",
            subjects: [
              `Limited Time: ${productName} Available Now`,
              `${productName} - Exclusive Access`,
              `Don't Miss: ${productName} Special Offer`
            ],
            body: `We're excited to offer you exclusive access to ${productName}.

For a limited time, take advantage of our special pricing and secure yours before inventory runs out.

Don't miss this opportunity.

Best regards,
The Team

P.S. - Order now and get free shipping.`,
            htmlBody: `<div style="font-family: sans-serif;  line-height: 1.8; color: #000;"><p>We're excited to offer you exclusive access to ${productName}.</p><p>For a limited time, take advantage of our special pricing and <a href="#" style="color: #0066cc; text-decoration: underline;">secure yours</a> before inventory runs out.</p><p>Don't miss this opportunity.</p><p>Best regards,<br>The Team</p><p style="font-style: italic; color: #666;">P.S. - <a href="#" style="color: #0066cc; text-decoration: underline;">Order now</a> and get free shipping.</p></div>`,
          },
          {
            id: "2",
            subjects: [
              `New Arrival: ${productName}`,
              `Introducing ${productName}`,
              `${productName} Now Available`
            ],
            body: `Introducing ${productName} - now available.

Discover what makes this special and why customers are already raving about it.

Explore now and see the difference for yourself.

The Team

P.S. - Early orders get priority shipping. Get yours today.`,
            htmlBody: `<div style="font-family: sans-serif;  line-height: 1.8; color: #000;"><p>Introducing ${productName} - now available.</p><p>Discover what makes this special and why customers are already raving about it.</p><p><a href="#" style="color: #0066cc; text-decoration: underline;">Explore now</a> and see the difference for yourself.</p><p>The Team</p><p style="font-style: italic; color: #666;">P.S. - Early orders get priority shipping. <a href="#" style="color: #0066cc; text-decoration: underline;">Get yours today</a>.</p></div>`,
          },
          {
            id: "3",
            subjects: [
              `Don't Miss Out: ${productName}`,
              `${productName} - Moving Fast`,
              `Last Chance for ${productName}`
            ],
            body: `Quick reminder about ${productName}.

Stock is moving faster than expected. If you've been considering this, now is the time.

The Team

P.S. - Grab yours before we sell out completely.`,
            htmlBody: `<div style="font-family: sans-serif;  line-height: 1.8; color: #000;"><p>Quick reminder about ${productName}.</p><p>Stock is moving faster than expected. If you've been considering this, <a href="#" style="color: #0066cc; text-decoration: underline;">now is the time</a>.</p><p>The Team</p><p style="font-style: italic; color: #666;">P.S. - <a href="#" style="color: #0066cc; text-decoration: underline;">Grab yours</a> before we sell out completely.</p></div>`,
          },
          {
            id: "4",
            subjects: [
              `Exclusive Offer: ${productName}`,
              `${productName} - Special Pricing`,
              `VIP Access: ${productName}`
            ],
            body: `You're receiving this exclusive offer on ${productName}.

Special pricing available for the next 48 hours only.

Claim your discount while it's still available.

The Team`,
            htmlBody: `<div style="font-family: sans-serif;  line-height: 1.8; color: #000;"><p>You're receiving this exclusive offer on ${productName}.</p><p>Special pricing available for the next 48 hours only.</p><p><a href="#" style="color: #0066cc; text-decoration: underline;">Claim your discount</a> while it's still available.</p><p>The Team</p></div>`,
          },
          {
            id: "5",
            subjects: [
              `${productName} - Perfect for You`,
              `Hand-Picked: ${productName}`,
              `You'll Love ${productName}`
            ],
            body: `Based on your interests, we think you'll love ${productName}.

Find out why this is quickly becoming a customer favorite.

Learn more and discover what makes it special.

The Team

P.S. - Try it risk-free with our satisfaction guarantee.`,
            htmlBody: `<div style="font-family: sans-serif;  line-height: 1.8; color: #000;"><p>Based on your interests, we think you'll love ${productName}.</p><p>Find out why this is quickly becoming a customer favorite.</p><p><a href="#" style="color: #0066cc; text-decoration: underline;">Learn more</a> and discover what makes it special.</p><p>The Team</p><p style="font-style: italic; color: #666;">P.S. - <a href="#" style="color: #0066cc; text-decoration: underline;">Try it risk-free</a> with our satisfaction guarantee.</p></div>`,
          },
        ];
      }

      setEmailVariations(variations);
      setActiveVariation("1");
      setIsGenerating(false);
  };

  const handleEdit = (id: string) => {
    const variation = emailVariations.find((v) => v.id === id);
    if (variation) {
      setEditingVariation(variation);
      setEditorOpen(true);
    }
  };

  const handleSaveEdit = (edited: { subjects: string[]; body: string; htmlBody: string }) => {
    if (!editingVariation) return;

    const updatedVariations = emailVariations.map((v) =>
      v.id === editingVariation.id
        ? { 
            ...v, 
            subjects: edited.subjects, 
            body: edited.body, 
            htmlBody: edited.htmlBody,
            edited: true,
            // Only set originals on first edit to preserve AI baseline
            originalSubjects: v.originalSubjects || v.subjects,
            originalBody: v.originalBody || v.body,
            originalHtmlBody: v.originalHtmlBody || v.htmlBody
          }
        : v
    );

    setEmailVariations(updatedVariations);
    
    // Log the changes for AI to learn from
    console.log("Edited email variation:", editingVariation.id);
    console.log("Original subjects:", editingVariation.originalSubjects || editingVariation.subjects);
    console.log("New subjects:", edited.subjects);
    console.log("Original body length:", (editingVariation.originalBody || editingVariation.body).length);
    console.log("New body length:", edited.body.length);
  };

  const handleSave = (id: string) => {
    const email = emailVariations.find((v) => v.id === id);
    if (!email || !lastConfig) {
      toast({
        title: "Error",
        description: "Cannot save: missing email data or configuration",
        variant: "destructive",
      });
      return;
    }

    // Prepare email data for saving
    const emailData: InsertEmail = {
      subject: email.subjects[0], // Use first subject as primary
      subjects: email.subjects,
      body: email.body,
      htmlBody: email.htmlBody,
      productIds: [lastConfig.productId],
      tone: lastConfig.toneAngle === 'custom' ? (lastConfig.customTone || 'custom') : lastConfig.toneAngle,
      status: "needs-review",
      openRate: null,
      clickRate: null,
      conversionRate: null,
      notes: null,
      edited: email.edited ? 1 : 0,
      originalSubjects: email.originalSubjects || null,
      originalBody: email.originalBody || null,
      originalHtmlBody: email.originalHtmlBody || null,
      editedAt: email.edited ? new Date().toISOString() : null,
      sessionId: null, // Not associated with a specific session when saved individually
      aiProvider: email.aiProvider || null, // Track which AI generated this email
    } as any;

    saveEmailMutation.mutate(emailData);
  };

  const handleRate = (id: string, rating: "winning" | "losing") => {
    console.log("Rating email variation", id, "as:", rating);
  };

  const activeEmail = emailVariations.find((v) => v.id === activeVariation) || emailVariations[0];

  // Determine initial tone values for reuse
  const predefinedTones = ["national-brands", "legendary-copywriters", "high-performing", "current-events", "you-won", "try-something-new"];
  const reuseEmail = reuseEmailData?.email;
  const reuseTone = reuseEmail?.tone;
  const isCustomTone = reuseTone && !predefinedTones.includes(reuseTone);
  
  const isReuseToneCustom = lastConfig?.toneAngle === "custom";
  
  const initialToneAngle = reuseEmailId 
    ? (isCustomTone ? "custom" : (reuseTone || ""))
    : (lastConfig?.toneAngle || "");
  const initialCustomTone = reuseEmailId
    ? (isCustomTone ? reuseTone : "")
    : (isReuseToneCustom ? lastConfig?.customTone || "" : "");

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:h-full">
        <div className="flex flex-col gap-4">
          <EmailGeneratorForm
            products={mockProducts}
            onGenerate={handleGenerate}
            onCancel={handleCancel}
            isLoading={isGenerating}
            initialProductId={reuseEmailId ? reuseEmail?.productIds?.[0] : (lastConfig?.productId || "")}
            initialToneAngle={initialToneAngle}
            initialCustomTone={initialCustomTone}
            reuseMode={!!reuseEmailId}
            originalEmail={reuseEmail ? {
              subjects: reuseEmail.subjects || undefined,
              subject: reuseEmail.subject,
              body: reuseEmail.body
            } : undefined}
          />
          
          {/* Glossary */}
          <Collapsible defaultOpen={false}>
            <Card>
              <CollapsibleTrigger className="w-full" data-testid="button-toggle-glossary">
                <CardHeader className="hover-elevate">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Info className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">Performance Indicators Guide</CardTitle>
                    </div>
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4 text-sm">
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Trophy className="h-4 w-4 text-chart-2" />
                        <span className="font-medium">Trophy Icon</span>
                      </div>
                      <p className="text-muted-foreground">
                        Indicates the top-performing tone based on win rate. Only appears when 3+ emails have been tested with that tone.
                      </p>
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="bg-chart-2/10 text-chart-2 border-chart-2/20">
                          45%
                        </Badge>
                        <span className="font-medium">Win Rate Percentage</span>
                      </div>
                      <p className="text-muted-foreground">
                        Shows success rate for emails tested with this tone (winners ÷ tested emails). Higher percentages indicate more successful campaigns.
                      </p>
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-xs bg-muted px-2 py-1 rounded">F+S</span>
                        <span className="font-medium text-xs bg-muted px-2 py-1 rounded">straight-sale</span>
                        <span className="font-medium">Offer Type Indicators</span>
                      </div>
                      <p className="text-muted-foreground">
                        Performance data is filtered by offer type. "F+S" shows Free+Shipping performance, "straight-sale" shows Straight Sale performance.
                      </p>
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">AI Learning Status</span>
                      </div>
                      <p className="text-muted-foreground">
                        "AI learns from X winning emails" means the system analyzes successful campaigns and adapts future generations. More winners = smarter AI.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
          
          {isGenerating && (
            <Card className="p-4" data-testid="card-generation-progress">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium" data-testid="text-generation-status">
                    {generationStatus}
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="text-generation-percentage">
                    {generationProgress}%
                  </p>
                </div>
                <Progress value={generationProgress} data-testid="progress-generation" />
              </div>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4 lg:h-full lg:overflow-auto">
          {(() => {
            const claudeSonnet45Variations = emailVariations.filter(v => v.aiProvider === 'claude-sonnet-4.5');
            const claudeSonnet4Variations = emailVariations.filter(v => v.aiProvider === 'claude-sonnet-4');
            const hasMultipleProviders = claudeSonnet45Variations.length > 0 && claudeSonnet4Variations.length > 0;

            // If no AI provider labels (legacy or reuse mode), show original tabs UI
            if (!hasMultipleProviders) {
              return (
                <>
                  {emailVariations.length > 1 && (
                    <Tabs value={activeVariation} onValueChange={setActiveVariation}>
                      <TabsList className="w-full justify-start">
                        {emailVariations.map((variation, idx) => (
                          <TabsTrigger
                            key={variation.id}
                            value={variation.id}
                            data-testid={`tab-variation-${variation.id}`}
                          >
                            Version {idx + 1}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  )}
                  {activeEmail ? (
                    <EmailPreview
                      subjects={activeEmail.subjects}
                      body={activeEmail.body}
                      htmlBody={activeEmail.htmlBody}
                      isLoading={isGenerating}
                      onEdit={() => handleEdit(activeVariation)}
                      onRegenerate={() => lastConfig && handleGenerate(lastConfig)}
                      onSave={() => handleSave(activeVariation)}
                    />
                  ) : (
                    !isGenerating && (
                      <Card className="p-6">
                        <p className="text-center text-muted-foreground">
                          No email variations generated. Please try generating emails with a different product or configuration.
                        </p>
                      </Card>
                    )
                  )}
                </>
              );
            }

            // Dual-AI mode: show collapsible sections
            return (
              <div className="space-y-4">
                {/* Claude Sonnet 4.5 Section - Always show */}
                <Collapsible 
                  open={claudeSectionOpen} 
                  onOpenChange={(open) => {
                    setClaudeSectionOpen(open);
                    // When opening Claude Sonnet 4.5 section, switch to first variation
                    if (open && claudeSonnet45Variations.length > 0) {
                      setActiveVariation(claudeSonnet45Variations[0].id);
                    }
                  }}
                >
                  <Card>
                    <CollapsibleTrigger className="w-full" data-testid="button-toggle-claude-sonnet-45">
                      <CardHeader className="hover-elevate">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">Claude Sonnet 4.5 ({claudeSonnet45Variations.length})</CardTitle>
                          {claudeSectionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="space-y-4 pt-0">
                        {claudeSonnet45Variations.length > 0 ? (
                          <>
                            <Tabs 
                              value={claudeSonnet45Variations.some(v => v.id === activeVariation) ? activeVariation : claudeSonnet45Variations[0]?.id}
                              onValueChange={setActiveVariation}
                            >
                              <TabsList className="w-full justify-start">
                                {claudeSonnet45Variations.map((variation, idx) => (
                                  <TabsTrigger
                                    key={variation.id}
                                    value={variation.id}
                                    data-testid={`tab-claude-sonnet-45-${idx + 1}`}
                                  >
                                    V{idx + 1}
                                  </TabsTrigger>
                                ))}
                              </TabsList>
                            </Tabs>
                            {claudeSonnet45Variations.find(v => v.id === activeVariation) && (
                              <EmailPreview
                                subjects={claudeSonnet45Variations.find(v => v.id === activeVariation)!.subjects}
                                body={claudeSonnet45Variations.find(v => v.id === activeVariation)!.body}
                                htmlBody={claudeSonnet45Variations.find(v => v.id === activeVariation)!.htmlBody}
                                isLoading={isGenerating}
                                onEdit={() => handleEdit(activeVariation)}
                                onRegenerate={() => lastConfig && handleGenerate(lastConfig)}
                                onSave={() => handleSave(activeVariation)}
                              />
                            )}
                          </>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground space-y-3">
                            <p className="font-medium">Claude Sonnet 4.5 did not generate emails for this request.</p>
                            {generationErrors.claudeSonnet45 && (
                              <div className="text-sm bg-destructive/10 text-destructive border border-destructive/20 rounded-md p-3 mx-auto max-w-md">
                                <p className="font-medium mb-1">Error Details:</p>
                                <p className="text-xs">{generationErrors.claudeSonnet45}</p>
                              </div>
                            )}
                            <p className="text-sm">This can happen occasionally. Try regenerating or check the Claude Sonnet 4 variations below.</p>
                          </div>
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

                {/* Claude Sonnet 4 Section */}
                {claudeSonnet4Variations.length > 0 && (
                  <Collapsible 
                    open={gptSectionOpen} 
                    onOpenChange={(open) => {
                      setGptSectionOpen(open);
                      // When opening Claude Sonnet 4 section, switch to first variation
                      if (open && claudeSonnet4Variations.length > 0) {
                        setActiveVariation(claudeSonnet4Variations[0].id);
                      }
                    }}
                  >
                    <Card>
                      <CollapsibleTrigger className="w-full" data-testid="button-toggle-claude-sonnet-4">
                        <CardHeader className="hover-elevate">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">Claude Sonnet 4 ({claudeSonnet4Variations.length})</CardTitle>
                            {gptSectionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                          </div>
                        </CardHeader>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <CardContent className="space-y-4 pt-0">
                          <Tabs 
                            value={claudeSonnet4Variations.some(v => v.id === activeVariation) ? activeVariation : claudeSonnet4Variations[0]?.id}
                            onValueChange={setActiveVariation}
                          >
                            <TabsList className="w-full justify-start">
                              {claudeSonnet4Variations.map((variation, idx) => (
                                <TabsTrigger
                                  key={variation.id}
                                  value={variation.id}
                                  data-testid={`tab-claude-sonnet-4-${idx + 1}`}
                                >
                                  V{idx + 1}
                                </TabsTrigger>
                              ))}
                            </TabsList>
                          </Tabs>
                          {claudeSonnet4Variations.find(v => v.id === activeVariation) && (
                            <EmailPreview
                              subjects={claudeSonnet4Variations.find(v => v.id === activeVariation)!.subjects}
                              body={claudeSonnet4Variations.find(v => v.id === activeVariation)!.body}
                              htmlBody={claudeSonnet4Variations.find(v => v.id === activeVariation)!.htmlBody}
                              isLoading={isGenerating}
                              onEdit={() => handleEdit(activeVariation)}
                              onRegenerate={() => lastConfig && handleGenerate(lastConfig)}
                              onSave={() => handleSave(activeVariation)}
                            />
                          )}
                        </CardContent>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {editingVariation && (
        <EmailEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          subjects={editingVariation.subjects}
          body={editingVariation.body}
          htmlBody={editingVariation.htmlBody}
          onSave={handleSaveEdit}
        />
      )}
    </>
  );
}
