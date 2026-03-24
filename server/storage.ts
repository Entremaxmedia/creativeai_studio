import { type Email, type InsertEmail, emails, type Product, type InsertProduct, products, type SavedImage, type InsertSavedImage, savedImages, type SmsMessage, type InsertSmsMessage, smsMessages, type SavedVideo, type InsertSavedVideo, savedVideos, type RateLimit, type InsertRateLimit, rateLimits, type GifConversion, type InsertGifConversion, gifConversions, type MtpFolder, type InsertMtpFolder, mtpFolders, type MtpImageFolder, type InsertMtpImageFolder, mtpImageFolders, type MtpNamingCategory, mtpNamingCategories, type MtpNamingProductId, mtpNamingProductIds, type MtpNamingType, mtpNamingTypes } from "@shared/schema";
import { randomUUID } from "crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, ne, desc, ilike, and, or, sql as sqlFn, count, isNull } from "drizzle-orm";

// Database connection
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  createEmail(email: InsertEmail): Promise<Email>;
  getEmails(): Promise<Email[]>;
  getEmailsPaginated(options: { 
    page: number; 
    limit: number; 
    search?: string; 
    status?: string; 
  }): Promise<{ items: Email[]; total: number; totalPages: number; currentPage: number }>;
  getEmail(id: string): Promise<Email | undefined>;
  getEmailsBySession(sessionId: string): Promise<Email[]>;
  updateEmail(id: string, email: Partial<InsertEmail>): Promise<Email | undefined>;
  deleteEmail(id: string): Promise<boolean>;
  getWinningEmails(limit?: number): Promise<Email[]>;
  getWinningEmailsByProduct(productId: string, limit?: number): Promise<Email[]>;
  getWinningEmailsByOfferType(offerType: string, limit?: number): Promise<Email[]>;
  getLosingEmails(limit?: number): Promise<Email[]>;
  getLosingEmailsByOfferType(offerType: string, limit?: number): Promise<Email[]>;
  
  createProduct(product: InsertProduct): Promise<Product>;
  getProducts(): Promise<Product[]>;
  getProductsPaginated(options: { 
    page: number; 
    limit: number; 
    search?: string; 
    offerType?: string; 
  }): Promise<{ items: Product[]; total: number; totalPages: number; currentPage: number }>;
  getProduct(id: string): Promise<Product | undefined>;
  updateProduct(id: string, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: string): Promise<boolean>;
  
  createSavedImage(image: InsertSavedImage): Promise<SavedImage>;
  getSavedImages(): Promise<SavedImage[]>;
  getSavedImagesPaginated(options: { 
    page: number; 
    limit: number; 
    productId?: string;
    includeUnsaved?: boolean;
  }): Promise<{ items: SavedImage[]; total: number; totalPages: number; currentPage: number }>;
  getSavedImagesByProduct(productId: string, includeUnsaved?: boolean): Promise<SavedImage[]>;
  getSavedImagesBySession(sessionId: string): Promise<SavedImage[]>;
  getSavedImage(id: string): Promise<SavedImage | undefined>;
  updateSavedImage(id: string, image: Partial<InsertSavedImage>): Promise<SavedImage | undefined>;
  deleteSavedImage(id: string): Promise<boolean>;
  
  createSmsMessage(sms: InsertSmsMessage): Promise<SmsMessage>;
  getSmsMessages(): Promise<SmsMessage[]>;
  getSmsMessagesByProduct(productId: string): Promise<SmsMessage[]>;
  getSmsMessage(id: string): Promise<SmsMessage | undefined>;
  updateSmsMessage(id: string, sms: Partial<InsertSmsMessage>): Promise<SmsMessage | undefined>;
  deleteSmsMessage(id: string): Promise<boolean>;
  
  createSavedVideo(video: InsertSavedVideo): Promise<SavedVideo>;
  getSavedVideos(): Promise<SavedVideo[]>;
  getSavedVideosPaginated(options: { page: number; limit: number; productId?: string }): Promise<{ videos: SavedVideo[]; total: number }>;
  getSavedVideosByProduct(productId: string): Promise<SavedVideo[]>;
  getSavedVideosBySession(sessionId: string): Promise<SavedVideo[]>;
  getSavedVideo(id: string): Promise<SavedVideo | undefined>;
  updateSavedVideo(id: string, video: Partial<InsertSavedVideo>): Promise<SavedVideo | undefined>;
  deleteSavedVideo(id: string): Promise<boolean>;
  
  getRateLimits(): Promise<RateLimit[]>;
  getRateLimit(modelName: string): Promise<RateLimit | undefined>;
  markModelCapped(modelName: string): Promise<RateLimit>;
  resetRateLimits(): Promise<void>;
  
  createGifConversion(conversion: InsertGifConversion): Promise<GifConversion>;
  getGifConversions(): Promise<GifConversion[]>;
  getGifConversion(id: string): Promise<GifConversion | undefined>;
  updateGifConversion(id: string, conversion: Partial<InsertGifConversion>): Promise<GifConversion | undefined>;
  deleteGifConversion(id: string): Promise<boolean>;
  
  createMtpFolder(folder: InsertMtpFolder): Promise<MtpFolder>;
  getMtpFolders(): Promise<MtpFolder[]>;
  getMtpFoldersByParent(parentId: string | null): Promise<MtpFolder[]>;
  getMtpFolder(id: string): Promise<MtpFolder | undefined>;
  getMtpFolderByShareCode(shareCode: string): Promise<MtpFolder | undefined>;
  updateMtpFolder(id: string, folder: Partial<InsertMtpFolder>): Promise<MtpFolder | undefined>;
  deleteMtpFolder(id: string): Promise<boolean>;
  
  addImageToFolder(imageKey: string, folderId: string): Promise<MtpImageFolder>;
  removeImageFromFolder(imageKey: string, folderId: string): Promise<boolean>;
  getImagesInFolder(folderId: string): Promise<MtpImageFolder[]>;
  getFolderForImage(imageKey: string): Promise<MtpImageFolder | undefined>;
  moveImagesToFolder(imageKeys: string[], folderId: string): Promise<void>;
  
  // MTP Naming Convention
  getMtpNamingCategories(): Promise<MtpNamingCategory[]>;
  createMtpNamingCategory(name: string, displayName: string): Promise<MtpNamingCategory>;
  getMtpNamingProductIds(): Promise<MtpNamingProductId[]>;
  createMtpNamingProductId(name: string, displayName: string): Promise<MtpNamingProductId>;
  getMtpNamingTypes(categoryId?: string): Promise<MtpNamingType[]>;
  createMtpNamingType(name: string, categoryId: string, displayName: string): Promise<MtpNamingType>;
  updateMtpNamingCategoryDisplayName(id: string, displayName: string): Promise<void>;
  updateMtpNamingProductIdDisplayName(id: string, displayName: string): Promise<void>;
  updateMtpNamingTypeDisplayName(id: string, displayName: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private emails: Map<string, Email>;
  private products: Map<string, Product>;
  private savedImages: Map<string, SavedImage>;
  private smsMessages: Map<string, SmsMessage>;
  private savedVideos: Map<string, SavedVideo>;
  private gifConversions: Map<string, GifConversion>;

  constructor() {
    this.emails = new Map();
    this.products = new Map();
    this.savedImages = new Map();
    this.smsMessages = new Map();
    this.savedVideos = new Map();
    this.gifConversions = new Map();
  }

  async createEmail(insertEmail: InsertEmail): Promise<Email> {
    const id = randomUUID();
    const email: Email = {
      id,
      subject: insertEmail.subject,
      subjects: insertEmail.subjects ?? null,
      body: insertEmail.body,
      htmlBody: insertEmail.htmlBody ?? null,
      productIds: insertEmail.productIds,
      tone: insertEmail.tone,
      status: insertEmail.status ?? "needs-testing",
      openRate: insertEmail.openRate ?? null,
      clickRate: insertEmail.clickRate ?? null,
      conversionRate: insertEmail.conversionRate ?? null,
      notes: insertEmail.notes ?? null,
      edited: insertEmail.edited ?? 0,
      originalSubjects: insertEmail.originalSubjects ?? null,
      originalBody: insertEmail.originalBody ?? null,
      originalHtmlBody: insertEmail.originalHtmlBody ?? null,
      editedAt: insertEmail.editedAt ?? null,
      sessionId: insertEmail.sessionId ?? null,
      aiProvider: insertEmail.aiProvider ?? null,
      createdAt: new Date(),
    };
    this.emails.set(id, email);
    return email;
  }

  async getEmails(): Promise<Email[]> {
    return Array.from(this.emails.values())
      .filter(email => email.status !== 'auto-generated')
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getEmailsPaginated(options: { 
    page: number; 
    limit: number; 
    search?: string; 
    status?: string; 
  }): Promise<{ items: Email[]; total: number; totalPages: number; currentPage: number }> {
    const { page, limit, search, status } = options;
    
    let filtered = Array.from(this.emails.values());
    
    // Always exclude auto-generated emails from library
    filtered = filtered.filter(email => email.status !== 'auto-generated');
    
    // Filter by status if provided (but never allow auto-generated)
    if (status && status !== 'auto-generated') {
      filtered = filtered.filter(email => email.status === status);
    }
    
    // Filter by search term (search in subject and body)
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(email => 
        email.subject.toLowerCase().includes(searchLower) ||
        email.body.toLowerCase().includes(searchLower)
      );
    }
    
    // Sort by created date (newest first)
    filtered.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const items = filtered.slice(offset, offset + limit);
    
    return {
      items,
      total,
      totalPages,
      currentPage: page
    };
  }

  async getEmail(id: string): Promise<Email | undefined> {
    return this.emails.get(id);
  }

  async getEmailsBySession(sessionId: string): Promise<Email[]> {
    return Array.from(this.emails.values()).filter(email => email.sessionId === sessionId);
  }

  async updateEmail(id: string, updates: Partial<InsertEmail>): Promise<Email | undefined> {
    const email = this.emails.get(id);
    if (!email) return undefined;
    
    const updatedEmail: Email = { ...email, ...updates };
    this.emails.set(id, updatedEmail);
    return updatedEmail;
  }

  async deleteEmail(id: string): Promise<boolean> {
    return this.emails.delete(id);
  }

  async getWinningEmails(limit: number = 10): Promise<Email[]> {
    const allEmails = Array.from(this.emails.values());
    return allEmails
      .filter(email => email.status === 'winner')
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, limit);
  }

  async getWinningEmailsByProduct(productId: string, limit: number = 5): Promise<Email[]> {
    const allEmails = Array.from(this.emails.values());
    return allEmails
      .filter(email => email.status === 'winner' && email.productIds.includes(productId))
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, limit);
  }

  async getWinningEmailsByOfferType(offerType: string, limit: number = 5): Promise<Email[]> {
    const allEmails = Array.from(this.emails.values());
    const productsArray = Array.from(this.products.values());
    
    return allEmails
      .filter(email => {
        if (email.status !== 'winner') return false;
        // Check if any of the email's products match the offer type
        return email.productIds.some(productId => {
          const product = productsArray.find(p => p.id === productId);
          return product?.offerType === offerType;
        });
      })
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, limit);
  }

  async getLosingEmails(limit: number = 10): Promise<Email[]> {
    const allEmails = Array.from(this.emails.values());
    return allEmails
      .filter(email => email.status === 'loser')
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, limit);
  }

  async getLosingEmailsByOfferType(offerType: string, limit: number = 5): Promise<Email[]> {
    const allEmails = Array.from(this.emails.values());
    const productsArray = Array.from(this.products.values());
    
    return allEmails
      .filter(email => {
        if (email.status !== 'loser') return false;
        return email.productIds.some(productId => {
          const product = productsArray.find(p => p.id === productId);
          return product?.offerType === offerType;
        });
      })
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, limit);
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const id = randomUUID();
    const product: Product = {
      id,
      name: insertProduct.name,
      displayName: insertProduct.displayName ?? null,
      offerType: insertProduct.offerType,
      offerLink: insertProduct.offerLink,
      manualContent: insertProduct.manualContent,
      imageUrl: insertProduct.imageUrl ?? null,
      createdAt: new Date(),
    };
    this.products.set(id, product);
    return product;
  }

  async getProducts(): Promise<Product[]> {
    return Array.from(this.products.values()).sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getProductsPaginated(options: { 
    page: number; 
    limit: number; 
    search?: string; 
    offerType?: string; 
  }): Promise<{ items: Product[]; total: number; totalPages: number; currentPage: number }> {
    let filtered = Array.from(this.products.values());

    // Apply search filter
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchLower) ||
        (p.displayName && p.displayName.toLowerCase().includes(searchLower))
      );
    }

    // Apply offer type filter
    if (options.offerType) {
      filtered = filtered.filter(p => p.offerType === options.offerType);
    }

    // Sort by creation date (newest first)
    filtered.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

    const total = filtered.length;
    const totalPages = Math.ceil(total / options.limit);
    const offset = (options.page - 1) * options.limit;
    const items = filtered.slice(offset, offset + options.limit);

    return {
      items,
      total,
      totalPages,
      currentPage: options.page
    };
  }

  async getProduct(id: string): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async updateProduct(id: string, updates: Partial<InsertProduct>): Promise<Product | undefined> {
    const product = this.products.get(id);
    if (!product) return undefined;
    
    const updatedProduct: Product = { ...product, ...updates };
    this.products.set(id, updatedProduct);
    return updatedProduct;
  }

  async deleteProduct(id: string): Promise<boolean> {
    return this.products.delete(id);
  }

  async createSavedImage(insertImage: InsertSavedImage): Promise<SavedImage> {
    const id = randomUUID();
    const savedImage: SavedImage = {
      id,
      url: insertImage.url,
      productId: insertImage.productId ?? null,
      provider: insertImage.provider,
      prompt: insertImage.prompt,
      revisedPrompt: insertImage.revisedPrompt ?? null,
      referenceImageUrl: insertImage.referenceImageUrl ?? null,
      sessionId: insertImage.sessionId ?? null,
      status: insertImage.status ?? 'saved',
      createdAt: new Date(),
    };
    this.savedImages.set(id, savedImage);
    return savedImage;
  }

  async getSavedImages(): Promise<SavedImage[]> {
    return Array.from(this.savedImages.values()).sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getSavedImagesPaginated(options: { page: number; limit: number; productId?: string; includeUnsaved?: boolean }): Promise<{ items: SavedImage[]; total: number; totalPages: number; currentPage: number }> {
    const { page, limit, productId, includeUnsaved = false } = options;
    
    let allImages = Array.from(this.savedImages.values());
    
    // Filter by status (default: only show "saved" images, not "auto-generated")
    if (!includeUnsaved) {
      allImages = allImages.filter(img => img.status === 'saved');
    }
    
    // Filter by product if specified
    if (productId) {
      if (productId === 'none') {
        allImages = allImages.filter(img => !img.productId);
      } else if (productId !== 'all') {
        allImages = allImages.filter(img => img.productId === productId);
      }
    }
    
    // Sort by creation date (newest first)
    allImages.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    
    const total = allImages.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const items = allImages.slice(offset, offset + limit);
    
    return { items, total, totalPages, currentPage: page };
  }

  async getSavedImagesByProduct(productId: string, includeUnsaved: boolean = false): Promise<SavedImage[]> {
    let images = Array.from(this.savedImages.values())
      .filter(img => img.productId === productId);
    
    // Filter by status (default: only show "saved" images, not "auto-generated")
    if (!includeUnsaved) {
      images = images.filter(img => img.status === 'saved');
    }
    
    return images.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getSavedImagesBySession(sessionId: string): Promise<SavedImage[]> {
    return Array.from(this.savedImages.values())
      .filter(img => img.sessionId === sessionId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getSavedImage(id: string): Promise<SavedImage | undefined> {
    return this.savedImages.get(id);
  }

  async updateSavedImage(id: string, updates: Partial<InsertSavedImage>): Promise<SavedImage | undefined> {
    const image = this.savedImages.get(id);
    if (!image) return undefined;
    
    const updatedImage: SavedImage = { ...image, ...updates };
    this.savedImages.set(id, updatedImage);
    return updatedImage;
  }

  async deleteSavedImage(id: string): Promise<boolean> {
    return this.savedImages.delete(id);
  }

  async createSmsMessage(insertSms: InsertSmsMessage): Promise<SmsMessage> {
    const id = randomUUID();
    const sms: SmsMessage = {
      id,
      message: insertSms.message,
      type: insertSms.type,
      brand: insertSms.brand,
      productId: insertSms.productId,
      angle: insertSms.angle ?? null,
      aiProvider: insertSms.aiProvider,
      characterCount: insertSms.characterCount,
      status: insertSms.status ?? "draft",
      notes: insertSms.notes ?? null,
      edited: insertSms.edited ?? 0,
      originalMessage: insertSms.originalMessage ?? null,
      editedAt: insertSms.editedAt ?? null,
      createdAt: new Date(),
    };
    this.smsMessages.set(id, sms);
    return sms;
  }

  async getSmsMessages(): Promise<SmsMessage[]> {
    return Array.from(this.smsMessages.values()).sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getSmsMessagesByProduct(productId: string): Promise<SmsMessage[]> {
    return Array.from(this.smsMessages.values())
      .filter(sms => sms.productId === productId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getSmsMessage(id: string): Promise<SmsMessage | undefined> {
    return this.smsMessages.get(id);
  }

  async updateSmsMessage(id: string, updates: Partial<InsertSmsMessage>): Promise<SmsMessage | undefined> {
    const sms = this.smsMessages.get(id);
    if (!sms) return undefined;
    
    const updatedSms: SmsMessage = { ...sms, ...updates };
    this.smsMessages.set(id, updatedSms);
    return updatedSms;
  }

  async deleteSmsMessage(id: string): Promise<boolean> {
    return this.smsMessages.delete(id);
  }

  async createSavedVideo(insertVideo: InsertSavedVideo): Promise<SavedVideo> {
    const id = randomUUID();
    const video: SavedVideo = {
      id,
      url: insertVideo.url,
      productId: insertVideo.productId ?? null,
      provider: insertVideo.provider,
      prompt: insertVideo.prompt,
      generationType: insertVideo.generationType,
      duration: insertVideo.duration,
      aspectRatio: insertVideo.aspectRatio ?? null,
      referenceImageUrls: insertVideo.referenceImageUrls ?? null,
      sessionId: insertVideo.sessionId ?? null,
      status: insertVideo.status ?? 'saved',
      createdAt: new Date(),
    };
    this.savedVideos.set(id, video);
    return video;
  }

  async getSavedVideos(): Promise<SavedVideo[]> {
    return Array.from(this.savedVideos.values()).sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getSavedVideosPaginated(options: { page: number; limit: number; productId?: string }): Promise<{ videos: SavedVideo[]; total: number }> {
    let allVideos = Array.from(this.savedVideos.values());
    if (options.productId) allVideos = allVideos.filter(v => v.productId === options.productId);
    allVideos.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    const start = (options.page - 1) * options.limit;
    return { videos: allVideos.slice(start, start + options.limit), total: allVideos.length };
  }

  async getSavedVideosByProduct(productId: string): Promise<SavedVideo[]> {
    return Array.from(this.savedVideos.values())
      .filter(video => video.productId === productId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getSavedVideosBySession(sessionId: string): Promise<SavedVideo[]> {
    return Array.from(this.savedVideos.values())
      .filter(video => video.sessionId === sessionId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getSavedVideo(id: string): Promise<SavedVideo | undefined> {
    return this.savedVideos.get(id);
  }

  async updateSavedVideo(id: string, updates: Partial<InsertSavedVideo>): Promise<SavedVideo | undefined> {
    const video = this.savedVideos.get(id);
    if (!video) return undefined;
    
    const updatedVideo: SavedVideo = { ...video, ...updates };
    this.savedVideos.set(id, updatedVideo);
    return updatedVideo;
  }

  async deleteSavedVideo(id: string): Promise<boolean> {
    return this.savedVideos.delete(id);
  }

  // Rate limit methods (placeholders - not used since we use DbStorage in production)
  async getRateLimits(): Promise<RateLimit[]> {
    return [];
  }

  async getRateLimit(modelName: string): Promise<RateLimit | undefined> {
    return undefined;
  }

  async markModelCapped(modelName: string): Promise<RateLimit> {
    const now = new Date();
    const resetTime = new Date(now);
    resetTime.setUTCHours(8, 0, 0, 0);
    if (resetTime <= now) {
      resetTime.setDate(resetTime.getDate() + 1);
    }
    
    return {
      id: randomUUID(),
      modelName,
      lastHitAt: now,
      resetsAt: resetTime,
      isCapped: 1,
      createdAt: now,
      updatedAt: now
    };
  }

  async resetRateLimits(): Promise<void> {
    // Placeholder - not used in production
  }

  // GIF conversion methods
  async createGifConversion(insertConversion: InsertGifConversion): Promise<GifConversion> {
    const id = randomUUID();
    const conversion: GifConversion = {
      id,
      sourceVideoUrl: insertConversion.sourceVideoUrl,
      cropX: insertConversion.cropX ?? 0,
      cropY: insertConversion.cropY ?? 0,
      cropWidth: insertConversion.cropWidth ?? null,
      cropHeight: insertConversion.cropHeight ?? null,
      startTime: insertConversion.startTime ?? 0,
      endTime: insertConversion.endTime ?? null,
      duration: insertConversion.duration ?? null,
      outputFormat: insertConversion.outputFormat,
      quality: insertConversion.quality ?? 80,
      fps: insertConversion.fps ?? 15,
      width: insertConversion.width ?? null,
      height: insertConversion.height ?? null,
      outputUrl: insertConversion.outputUrl ?? null,
      fileSize: insertConversion.fileSize ?? null,
      status: insertConversion.status ?? 'pending',
      errorMessage: insertConversion.errorMessage ?? null,
      createdAt: new Date(),
    };
    this.gifConversions.set(id, conversion);
    return conversion;
  }

  async getGifConversions(): Promise<GifConversion[]> {
    return Array.from(this.gifConversions.values()).sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getGifConversion(id: string): Promise<GifConversion | undefined> {
    return this.gifConversions.get(id);
  }

  async updateGifConversion(id: string, updates: Partial<InsertGifConversion>): Promise<GifConversion | undefined> {
    const conversion = this.gifConversions.get(id);
    if (!conversion) return undefined;
    
    const updatedConversion: GifConversion = { ...conversion, ...updates };
    this.gifConversions.set(id, updatedConversion);
    return updatedConversion;
  }

  async deleteGifConversion(id: string): Promise<boolean> {
    return this.gifConversions.delete(id);
  }

  async createMtpFolder(_folder: InsertMtpFolder): Promise<MtpFolder> {
    throw new Error("MemStorage does not support MTP folders");
  }
  async getMtpFolders(): Promise<MtpFolder[]> { return []; }
  async getMtpFoldersByParent(_parentId: string | null): Promise<MtpFolder[]> { return []; }
  async getMtpFolder(_id: string): Promise<MtpFolder | undefined> { return undefined; }
  async getMtpFolderByShareCode(_shareCode: string): Promise<MtpFolder | undefined> { return undefined; }
  async updateMtpFolder(_id: string, _folder: Partial<InsertMtpFolder>): Promise<MtpFolder | undefined> { return undefined; }
  async deleteMtpFolder(_id: string): Promise<boolean> { return false; }
  async addImageToFolder(_imageKey: string, _folderId: string): Promise<MtpImageFolder> { throw new Error("MemStorage does not support MTP folders"); }
  async removeImageFromFolder(_imageKey: string, _folderId: string): Promise<boolean> { return false; }
  async getImagesInFolder(_folderId: string): Promise<MtpImageFolder[]> { return []; }
  async getFolderForImage(_imageKey: string): Promise<MtpImageFolder | undefined> { return undefined; }
  async moveImagesToFolder(_imageKeys: string[], _folderId: string): Promise<void> { }
  async getMtpNamingCategories(): Promise<MtpNamingCategory[]> { return []; }
  async createMtpNamingCategory(_name: string, _displayName: string): Promise<MtpNamingCategory> { throw new Error("MemStorage does not support MTP naming"); }
  async getMtpNamingProductIds(): Promise<MtpNamingProductId[]> { return []; }
  async createMtpNamingProductId(_name: string, _displayName: string): Promise<MtpNamingProductId> { throw new Error("MemStorage does not support MTP naming"); }
  async getMtpNamingTypes(_categoryId?: string): Promise<MtpNamingType[]> { return []; }
  async createMtpNamingType(_name: string, _categoryId: string, _displayName: string): Promise<MtpNamingType> { throw new Error("MemStorage does not support MTP naming"); }
  async updateMtpNamingCategoryDisplayName(_id: string, _displayName: string): Promise<void> { }
  async updateMtpNamingProductIdDisplayName(_id: string, _displayName: string): Promise<void> { }
  async updateMtpNamingTypeDisplayName(_id: string, _displayName: string): Promise<void> { }
}

export class DbStorage implements IStorage {
  async createEmail(insertEmail: InsertEmail): Promise<Email> {
    const [email] = await db.insert(emails).values(insertEmail).returning();
    return email;
  }

  async getEmails(): Promise<Email[]> {
    return await db.select().from(emails).where(ne(emails.status, 'auto-generated')).orderBy(desc(emails.createdAt));
  }

  async getEmailsPaginated(options: { 
    page: number; 
    limit: number; 
    search?: string; 
    status?: string; 
  }): Promise<{ items: Email[]; total: number; totalPages: number; currentPage: number }> {
    const { page, limit, search, status } = options;
    
    const conditions = [];
    
    // Always exclude auto-generated emails from library
    conditions.push(ne(emails.status, 'auto-generated'));
    
    // Filter by status if provided (but never allow auto-generated)
    if (status && status !== 'auto-generated') {
      conditions.push(eq(emails.status, status));
    }
    
    // Filter by search term (search in subject and body)
    if (search) {
      conditions.push(
        or(
          ilike(emails.subject, `%${search}%`),
          ilike(emails.body, `%${search}%`)
        )!
      );
    }
    
    // Build where clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    // Get total count
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(emails)
      .where(whereClause);
    
    // Get paginated items
    const offset = (page - 1) * limit;
    const items = await db
      .select()
      .from(emails)
      .where(whereClause)
      .orderBy(desc(emails.createdAt))
      .limit(limit)
      .offset(offset);
    
    const totalPages = Math.ceil(total / limit);
    
    return {
      items,
      total,
      totalPages,
      currentPage: page
    };
  }

  async getEmail(id: string): Promise<Email | undefined> {
    const [email] = await db.select().from(emails).where(eq(emails.id, id));
    return email;
  }

  async getEmailsBySession(sessionId: string): Promise<Email[]> {
    return await db.select().from(emails).where(eq(emails.sessionId, sessionId)).orderBy(desc(emails.createdAt));
  }

  async updateEmail(id: string, updates: Partial<InsertEmail>): Promise<Email | undefined> {
    const [email] = await db.update(emails).set(updates).where(eq(emails.id, id)).returning();
    return email;
  }

  async deleteEmail(id: string): Promise<boolean> {
    const result = await db.delete(emails).where(eq(emails.id, id)).returning();
    return result.length > 0;
  }

  async getWinningEmails(limit: number = 10): Promise<Email[]> {
    return await db
      .select()
      .from(emails)
      .where(eq(emails.status, 'winner'))
      .orderBy(desc(emails.createdAt))
      .limit(limit);
  }

  async getWinningEmailsByProduct(productId: string, limit: number = 5): Promise<Email[]> {
    // Note: This query filters in memory because productIds is an array column
    const allWinners = await db
      .select()
      .from(emails)
      .where(eq(emails.status, 'winner'))
      .orderBy(desc(emails.createdAt));
    
    return allWinners
      .filter(email => email.productIds.includes(productId))
      .slice(0, limit);
  }

  async getWinningEmailsByOfferType(offerType: string, limit: number = 5): Promise<Email[]> {
    // Fetch all winning emails and all products
    const allWinners = await db
      .select()
      .from(emails)
      .where(eq(emails.status, 'winner'))
      .orderBy(desc(emails.createdAt));
    
    const allProducts = await db.select().from(products);
    
    // Filter emails where at least one product matches the offer type
    return allWinners
      .filter(email => {
        return email.productIds.some(productId => {
          const product = allProducts.find(p => p.id === productId);
          return product?.offerType === offerType;
        });
      })
      .slice(0, limit);
  }

  async getLosingEmails(limit: number = 10): Promise<Email[]> {
    return await db
      .select()
      .from(emails)
      .where(eq(emails.status, 'loser'))
      .orderBy(desc(emails.createdAt))
      .limit(limit);
  }

  async getLosingEmailsByOfferType(offerType: string, limit: number = 5): Promise<Email[]> {
    const allLosers = await db
      .select()
      .from(emails)
      .where(eq(emails.status, 'loser'))
      .orderBy(desc(emails.createdAt));
    
    const allProducts = await db.select().from(products);
    
    return allLosers
      .filter(email => {
        return email.productIds.some(productId => {
          const product = allProducts.find(p => p.id === productId);
          return product?.offerType === offerType;
        });
      })
      .slice(0, limit);
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(insertProduct).returning();
    return product;
  }

  async getProducts(): Promise<Product[]> {
    return await db.select().from(products).orderBy(desc(products.createdAt));
  }

  async getProductsPaginated(options: { 
    page: number; 
    limit: number; 
    search?: string; 
    offerType?: string; 
  }): Promise<{ items: Product[]; total: number; totalPages: number; currentPage: number }> {
    const conditions = [];

    // Apply search filter (search in name and displayName)
    if (options.search) {
      conditions.push(
        or(
          ilike(products.name, `%${options.search}%`),
          ilike(products.displayName, `%${options.search}%`)
        )
      );
    }

    // Apply offer type filter
    if (options.offerType) {
      conditions.push(eq(products.offerType, options.offerType));
    }

    // Build where clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(products)
      .where(whereClause);

    // Get paginated items
    const offset = (options.page - 1) * options.limit;
    const items = await db
      .select()
      .from(products)
      .where(whereClause)
      .orderBy(desc(products.createdAt))
      .limit(options.limit)
      .offset(offset);

    const totalPages = Math.ceil(total / options.limit);

    return {
      items,
      total,
      totalPages,
      currentPage: options.page
    };
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async updateProduct(id: string, updates: Partial<InsertProduct>): Promise<Product | undefined> {
    const [product] = await db.update(products).set(updates).where(eq(products.id, id)).returning();
    return product;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const result = await db.delete(products).where(eq(products.id, id)).returning();
    return result.length > 0;
  }

  async createSavedImage(insertImage: InsertSavedImage): Promise<SavedImage> {
    const id = crypto.randomUUID();
    const cleanData = {
      id,
      url: insertImage.url,
      provider: insertImage.provider,
      prompt: insertImage.prompt,
      productId: insertImage.productId ?? null,
      revisedPrompt: insertImage.revisedPrompt ?? null,
      referenceImageUrl: insertImage.referenceImageUrl ?? null,
      sessionId: insertImage.sessionId ?? null,
      status: insertImage.status ?? 'saved',
    };
    await db.insert(savedImages).values(cleanData);
    const [result] = await db.select().from(savedImages).where(eq(savedImages.id, id));
    return result;
  }

  async getSavedImages(): Promise<SavedImage[]> {
    return await db.select().from(savedImages).orderBy(desc(savedImages.createdAt));
  }

  async getSavedImagesPaginated(options: { page: number; limit: number; productId?: string; includeUnsaved?: boolean }): Promise<{ items: SavedImage[]; total: number; totalPages: number; currentPage: number }> {
    try {
      console.log('[getSavedImagesPaginated] Options:', JSON.stringify(options));
      const { includeUnsaved = false, productId, page, limit } = options;
      
      // Start with base query
      let query = db.select().from(savedImages);
      let countQuery = db.select({ value: count() }).from(savedImages);

      // Build conditions array
      const conditions = [];

      // Filter by product if specified
      if (productId) {
        if (productId === 'none') {
          conditions.push(isNull(savedImages.productId));
        } else if (productId !== 'all') {
          conditions.push(eq(savedImages.productId, productId));
        }
      }

      // Filter by status only if includeUnsaved is false
      // This filter is applied separately to handle potential schema issues
      if (!includeUnsaved) {
        conditions.push(eq(savedImages.status, 'saved'));
      }

      console.log('[getSavedImagesPaginated] Conditions count:', conditions.length);

      // Apply where clause if we have conditions
      if (conditions.length > 0) {
        const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
        console.log('[getSavedImagesPaginated] Applying where clause with', conditions.length, 'condition(s)');
        
        // Get total count with where clause
        try {
          const countResult = await countQuery.where(whereClause);
          const total = Number(countResult[0]?.value ?? 0);
          console.log('[getSavedImagesPaginated] Total images:', total);

          // Get paginated items with where clause
          // Use SQL CASE to conditionally return URL or placeholder based on size
          const offset = (page - 1) * limit;
          const items = await db
            .select({
              id: savedImages.id,
              // Return actual URL if small (<100KB) or starts with /storage/, otherwise use placeholder
              url: sqlFn<string>`
                CASE 
                  WHEN LENGTH(${savedImages.url}) < 100000 OR ${savedImages.url} LIKE '/storage/%' 
                  THEN ${savedImages.url}
                  ELSE CONCAT('/api/saved-images/', ${savedImages.id}::text, '/image')
                END
              `,
              productId: savedImages.productId,
              provider: savedImages.provider,
              prompt: savedImages.prompt,
              revisedPrompt: savedImages.revisedPrompt,
              // Also optimize reference image URL
              referenceImageUrl: sqlFn<string>`
                CASE
                  WHEN ${savedImages.referenceImageUrl} IS NULL THEN NULL
                  WHEN LENGTH(${savedImages.referenceImageUrl}) < 100000 OR ${savedImages.referenceImageUrl} LIKE '/storage/%'
                  THEN ${savedImages.referenceImageUrl}
                  ELSE CONCAT('/api/saved-images/', ${savedImages.id}::text, '/reference-image')
                END
              `,
              sessionId: savedImages.sessionId,
              status: savedImages.status,
              createdAt: savedImages.createdAt,
            })
            .from(savedImages)
            .where(whereClause)
            .orderBy(desc(savedImages.createdAt))
            .limit(limit)
            .offset(offset);
          
          console.log(`[OPTIMIZATION] Retrieved ${items.length} items with optimized URLs`);
          console.log('[getSavedImagesPaginated] Retrieved', items.length, 'items');

          const totalPages = Math.max(1, Math.ceil(total / limit));

          return {
            items,
            total,
            totalPages,
            currentPage: page
          };
        } catch (queryError) {
          console.error('[getSavedImagesPaginated] Query with conditions failed:', queryError);
          throw queryError;
        }
      } else {
        // No conditions - get all images
        console.log('[getSavedImagesPaginated] No conditions, fetching all images');
        try {
          const countResult = await countQuery;
          const total = Number(countResult[0]?.value ?? 0);
          console.log('[getSavedImagesPaginated] Total images:', total);

          // Get paginated items with optimized URLs
          const offset = (page - 1) * limit;
          const items = await db
            .select({
              id: savedImages.id,
              // Return actual URL if small (<100KB) or starts with /storage/, otherwise use placeholder
              url: sqlFn<string>`
                CASE 
                  WHEN LENGTH(${savedImages.url}) < 100000 OR ${savedImages.url} LIKE '/storage/%' 
                  THEN ${savedImages.url}
                  ELSE CONCAT('/api/saved-images/', ${savedImages.id}::text, '/image')
                END
              `,
              productId: savedImages.productId,
              provider: savedImages.provider,
              prompt: savedImages.prompt,
              revisedPrompt: savedImages.revisedPrompt,
              // Also optimize reference image URL
              referenceImageUrl: sqlFn<string>`
                CASE
                  WHEN ${savedImages.referenceImageUrl} IS NULL THEN NULL
                  WHEN LENGTH(${savedImages.referenceImageUrl}) < 100000 OR ${savedImages.referenceImageUrl} LIKE '/storage/%'
                  THEN ${savedImages.referenceImageUrl}
                  ELSE CONCAT('/api/saved-images/', ${savedImages.id}::text, '/reference-image')
                END
              `,
              sessionId: savedImages.sessionId,
              status: savedImages.status,
              createdAt: savedImages.createdAt,
            })
            .from(savedImages)
            .orderBy(desc(savedImages.createdAt))
            .limit(limit)
            .offset(offset);
          
          console.log(`[OPTIMIZATION] Retrieved ${items.length} items with optimized URLs`);
          console.log('[getSavedImagesPaginated] Retrieved', items.length, 'items');

          const totalPages = Math.max(1, Math.ceil(total / limit));

          return {
            items,
            total,
            totalPages,
            currentPage: page
          };
        } catch (queryError) {
          console.error('[getSavedImagesPaginated] Query without conditions failed:', queryError);
          throw queryError;
        }
      }
    } catch (error) {
      console.error('[getSavedImagesPaginated] Error:', error);
      console.error('[getSavedImagesPaginated] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
      throw error;
    }
  }

  async getSavedImagesByProduct(productId: string, includeUnsaved: boolean = false): Promise<SavedImage[]> {
    // Build where clause based on includeUnsaved parameter
    const whereClause = includeUnsaved
      ? eq(savedImages.productId, productId)
      : and(eq(savedImages.productId, productId), eq(savedImages.status, 'saved'));
    
    return await db.select().from(savedImages).where(whereClause).orderBy(desc(savedImages.createdAt));
  }

  async getSavedImagesBySession(sessionId: string): Promise<SavedImage[]> {
    return await db.select().from(savedImages).where(eq(savedImages.sessionId, sessionId)).orderBy(desc(savedImages.createdAt));
  }

  async getSavedImage(id: string): Promise<SavedImage | undefined> {
    const [savedImage] = await db.select().from(savedImages).where(eq(savedImages.id, id));
    return savedImage;
  }

  async updateSavedImage(id: string, updates: Partial<InsertSavedImage>): Promise<SavedImage | undefined> {
    const [savedImage] = await db.update(savedImages).set(updates).where(eq(savedImages.id, id)).returning();
    return savedImage;
  }

  async deleteSavedImage(id: string): Promise<boolean> {
    const result = await db.delete(savedImages).where(eq(savedImages.id, id)).returning();
    return result.length > 0;
  }

  async createSmsMessage(insertSms: InsertSmsMessage): Promise<SmsMessage> {
    const [sms] = await db.insert(smsMessages).values(insertSms).returning();
    return sms;
  }

  async getSmsMessages(): Promise<SmsMessage[]> {
    return await db.select().from(smsMessages).orderBy(desc(smsMessages.createdAt));
  }

  async getSmsMessagesByProduct(productId: string): Promise<SmsMessage[]> {
    return await db.select().from(smsMessages).where(eq(smsMessages.productId, productId)).orderBy(desc(smsMessages.createdAt));
  }

  async getSmsMessage(id: string): Promise<SmsMessage | undefined> {
    const [sms] = await db.select().from(smsMessages).where(eq(smsMessages.id, id));
    return sms;
  }

  async updateSmsMessage(id: string, updates: Partial<InsertSmsMessage>): Promise<SmsMessage | undefined> {
    const [sms] = await db.update(smsMessages).set(updates).where(eq(smsMessages.id, id)).returning();
    return sms;
  }

  async deleteSmsMessage(id: string): Promise<boolean> {
    const result = await db.delete(smsMessages).where(eq(smsMessages.id, id)).returning();
    return result.length > 0;
  }

  async createSavedVideo(insertVideo: InsertSavedVideo): Promise<SavedVideo> {
    const [savedVideo] = await db.insert(savedVideos).values(insertVideo).returning();
    return savedVideo;
  }

  async getSavedVideos(): Promise<SavedVideo[]> {
    return await db.select().from(savedVideos).orderBy(desc(savedVideos.createdAt));
  }

  async getSavedVideosPaginated(options: { page: number; limit: number; productId?: string }): Promise<{ videos: SavedVideo[]; total: number }> {
    const { page, limit, productId } = options;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (productId && productId !== 'all') {
      if (productId === 'none') {
        conditions.push(isNull(savedVideos.productId));
      } else {
        conditions.push(eq(savedVideos.productId, productId));
      }
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db.select({ count: sqlFn<number>`count(*)` }).from(savedVideos).where(whereClause);
    const total = Number(countResult.count);

    const videos = await db.select({
      id: savedVideos.id,
      url: savedVideos.url,
      productId: savedVideos.productId,
      provider: savedVideos.provider,
      prompt: savedVideos.prompt,
      generationType: savedVideos.generationType,
      duration: savedVideos.duration,
      aspectRatio: savedVideos.aspectRatio,
      referenceImageUrls: savedVideos.referenceImageUrls,
      sessionId: savedVideos.sessionId,
      status: savedVideos.status,
      createdAt: savedVideos.createdAt,
    }).from(savedVideos).where(whereClause).orderBy(desc(savedVideos.createdAt)).limit(limit).offset(offset);

    return { videos, total };
  }

  async getSavedVideosByProduct(productId: string): Promise<SavedVideo[]> {
    return await db.select().from(savedVideos).where(eq(savedVideos.productId, productId)).orderBy(desc(savedVideos.createdAt));
  }

  async getSavedVideosBySession(sessionId: string): Promise<SavedVideo[]> {
    return await db.select().from(savedVideos).where(eq(savedVideos.sessionId, sessionId)).orderBy(desc(savedVideos.createdAt));
  }

  async getSavedVideo(id: string): Promise<SavedVideo | undefined> {
    const [savedVideo] = await db.select().from(savedVideos).where(eq(savedVideos.id, id));
    return savedVideo;
  }

  async updateSavedVideo(id: string, updates: Partial<InsertSavedVideo>): Promise<SavedVideo | undefined> {
    const [savedVideo] = await db.update(savedVideos).set(updates).where(eq(savedVideos.id, id)).returning();
    return savedVideo;
  }

  async deleteSavedVideo(id: string): Promise<boolean> {
    const result = await db.delete(savedVideos).where(eq(savedVideos.id, id)).returning();
    return result.length > 0;
  }

  async getRateLimits(): Promise<RateLimit[]> {
    return await db.select().from(rateLimits);
  }

  async getRateLimit(modelName: string): Promise<RateLimit | undefined> {
    const [rateLimit] = await db.select().from(rateLimits).where(eq(rateLimits.modelName, modelName));
    return rateLimit;
  }

  async markModelCapped(modelName: string): Promise<RateLimit> {
    // Calculate reset time: 3:00 AM EST next day
    const now = new Date();
    const resetTime = new Date(now);
    
    // Convert to EST (UTC-5 in standard time, UTC-4 in DST)
    // For simplicity, we'll use UTC-5
    resetTime.setUTCHours(8, 0, 0, 0); // 3:00 AM EST = 8:00 AM UTC
    
    // If it's already past 3:00 AM EST today, set for tomorrow
    if (resetTime <= now) {
      resetTime.setDate(resetTime.getDate() + 1);
    }

    // Check if entry exists
    const existing = await this.getRateLimit(modelName);
    
    if (existing) {
      // Update existing entry
      const [updated] = await db.update(rateLimits)
        .set({
          lastHitAt: now,
          resetsAt: resetTime,
          isCapped: 1,
          updatedAt: now
        })
        .where(eq(rateLimits.modelName, modelName))
        .returning();
      return updated;
    } else {
      // Create new entry
      const [created] = await db.insert(rateLimits)
        .values({
          modelName,
          lastHitAt: now,
          resetsAt: resetTime,
          isCapped: 1
        })
        .returning();
      return created;
    }
  }

  async resetRateLimits(): Promise<void> {
    const now = new Date();
    // Reset all models where resetsAt time has passed
    await db.update(rateLimits)
      .set({ isCapped: 0, updatedAt: now })
      .where(eq(rateLimits.isCapped, 1));
  }

  async createGifConversion(insertConversion: InsertGifConversion): Promise<GifConversion> {
    const [conversion] = await db.insert(gifConversions).values(insertConversion).returning();
    return conversion;
  }

  async getGifConversions(): Promise<GifConversion[]> {
    return await db.select().from(gifConversions).orderBy(desc(gifConversions.createdAt));
  }

  async getGifConversion(id: string): Promise<GifConversion | undefined> {
    const [conversion] = await db.select().from(gifConversions).where(eq(gifConversions.id, id));
    return conversion;
  }

  async updateGifConversion(id: string, updates: Partial<InsertGifConversion>): Promise<GifConversion | undefined> {
    const [conversion] = await db.update(gifConversions).set(updates).where(eq(gifConversions.id, id)).returning();
    return conversion;
  }

  async deleteGifConversion(id: string): Promise<boolean> {
    const result = await db.delete(gifConversions).where(eq(gifConversions.id, id)).returning();
    return result.length > 0;
  }

  async createMtpFolder(insertFolder: InsertMtpFolder): Promise<MtpFolder> {
    const id = randomUUID();
    await db.insert(mtpFolders).values({ ...insertFolder, id });
    const [folder] = await db.select().from(mtpFolders).where(eq(mtpFolders.id, id));
    return folder;
  }

  async getMtpFolders(): Promise<MtpFolder[]> {
    return await db.select().from(mtpFolders).orderBy(mtpFolders.name);
  }

  async getMtpFoldersByParent(parentId: string | null): Promise<MtpFolder[]> {
    try {
      if (parentId === null) {
        const result = await db.select().from(mtpFolders).where(isNull(mtpFolders.parentId)).orderBy(mtpFolders.name);
        return result || [];
      }
      const result = await db.select().from(mtpFolders).where(eq(mtpFolders.parentId, parentId)).orderBy(mtpFolders.name);
      return result || [];
    } catch (e) {
      return [];
    }
  }

  async getMtpFolder(id: string): Promise<MtpFolder | undefined> {
    try {
      const [folder] = await db.select().from(mtpFolders).where(eq(mtpFolders.id, id));
      return folder;
    } catch (e) {
      return undefined;
    }
  }

  async getMtpFolderByShareCode(shareCode: string): Promise<MtpFolder | undefined> {
    try {
      const [folder] = await db.select().from(mtpFolders).where(eq(mtpFolders.shareCode, shareCode));
      return folder;
    } catch (e) {
      return undefined;
    }
  }

  async updateMtpFolder(id: string, updates: Partial<InsertMtpFolder>): Promise<MtpFolder | undefined> {
    await db.update(mtpFolders).set(updates).where(eq(mtpFolders.id, id));
    const [folder] = await db.select().from(mtpFolders).where(eq(mtpFolders.id, id));
    return folder;
  }

  async deleteMtpFolder(id: string): Promise<boolean> {
    // Delete all image-folder associations first
    await db.delete(mtpImageFolders).where(eq(mtpImageFolders.folderId, id));
    // Delete subfolders recursively (safe: returns [] if none)
    const subfolders = await this.getMtpFoldersByParent(id);
    for (const subfolder of subfolders) {
      await this.deleteMtpFolder(subfolder.id);
    }
    // Delete folder without .returning() to avoid Neon driver bug
    await db.delete(mtpFolders).where(eq(mtpFolders.id, id));
    return true;
  }

  async addImageToFolder(imageKey: string, folderId: string): Promise<MtpImageFolder> {
    // Remove from any existing folder first
    await db.delete(mtpImageFolders).where(eq(mtpImageFolders.imageKey, imageKey));
    const id = randomUUID();
    await db.insert(mtpImageFolders).values({ id, imageKey, folderId });
    const [imageFolder] = await db.select().from(mtpImageFolders).where(eq(mtpImageFolders.id, id));
    return imageFolder;
  }

  async removeImageFromFolder(imageKey: string, folderId: string): Promise<boolean> {
    await db.delete(mtpImageFolders)
      .where(and(eq(mtpImageFolders.imageKey, imageKey), eq(mtpImageFolders.folderId, folderId)));
    return true;
  }

  async getImagesInFolder(folderId: string): Promise<MtpImageFolder[]> {
    try {
      const result = await db.select().from(mtpImageFolders).where(eq(mtpImageFolders.folderId, folderId));
      return result || [];
    } catch (e) {
      return [];
    }
  }

  async getFolderForImage(imageKey: string): Promise<MtpImageFolder | undefined> {
    try {
      const [imageFolder] = await db.select().from(mtpImageFolders).where(eq(mtpImageFolders.imageKey, imageKey));
      return imageFolder;
    } catch (e) {
      return undefined;
    }
  }

  async moveImagesToFolder(imageKeys: string[], folderId: string): Promise<void> {
    for (const imageKey of imageKeys) {
      await this.addImageToFolder(imageKey, folderId);
    }
  }

  // MTP Naming Convention methods
  async getMtpNamingCategories(): Promise<MtpNamingCategory[]> {
    return await db.select().from(mtpNamingCategories).orderBy(mtpNamingCategories.name);
  }

  async createMtpNamingCategory(name: string, displayName: string): Promise<MtpNamingCategory> {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const [category] = await db.insert(mtpNamingCategories).values({ name: cleanName, displayName }).returning();
    return category;
  }

  async getMtpNamingProductIds(): Promise<MtpNamingProductId[]> {
    return await db.select().from(mtpNamingProductIds).orderBy(mtpNamingProductIds.name);
  }

  async createMtpNamingProductId(name: string, displayName: string): Promise<MtpNamingProductId> {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const [productId] = await db.insert(mtpNamingProductIds).values({ name: cleanName, displayName }).returning();
    return productId;
  }

  async getMtpNamingTypes(categoryId?: string): Promise<MtpNamingType[]> {
    if (categoryId) {
      return await db.select().from(mtpNamingTypes).where(eq(mtpNamingTypes.categoryId, categoryId)).orderBy(mtpNamingTypes.name);
    }
    return await db.select().from(mtpNamingTypes).orderBy(mtpNamingTypes.name);
  }

  async createMtpNamingType(name: string, categoryId: string, displayName: string): Promise<MtpNamingType> {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const [type] = await db.insert(mtpNamingTypes).values({ name: cleanName, categoryId, displayName }).returning();
    return type;
  }

  async updateMtpNamingCategoryDisplayName(id: string, displayName: string): Promise<void> {
    await db.update(mtpNamingCategories).set({ displayName }).where(eq(mtpNamingCategories.id, id));
  }

  async updateMtpNamingProductIdDisplayName(id: string, displayName: string): Promise<void> {
    await db.update(mtpNamingProductIds).set({ displayName }).where(eq(mtpNamingProductIds.id, id));
  }

  async updateMtpNamingTypeDisplayName(id: string, displayName: string): Promise<void> {
    await db.update(mtpNamingTypes).set({ displayName }).where(eq(mtpNamingTypes.id, id));
  }
}

export const storage = new DbStorage();
