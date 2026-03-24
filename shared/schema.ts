import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  displayName: text("display_name"), // Optional: name to use in emails (defaults to name)
  offerType: text("offer_type").notNull(),
  offerLink: text("offer_link").notNull(),
  manualContent: text("manual_content").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export const emails = pgTable("emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subject: text("subject").notNull(),
  subjects: text("subjects").array(),
  body: text("body").notNull(),
  htmlBody: text("html_body"),
  productIds: text("product_ids").array().notNull(),
  tone: text("tone").notNull(),
  status: text("status").default("needs-review"),
  openRate: real("open_rate"),
  clickRate: real("click_rate"),
  conversionRate: real("conversion_rate"),
  notes: text("notes"),
  edited: integer("edited").default(0),
  originalSubjects: text("original_subjects").array(),
  originalBody: text("original_body"),
  originalHtmlBody: text("original_html_body"),
  editedAt: timestamp("edited_at"),
  sessionId: varchar("session_id"), // Links emails from the same generation session
  aiProvider: text("ai_provider"), // 'gpt-5' | 'claude'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailSchema = createInsertSchema(emails).omit({
  id: true,
  createdAt: true,
});

export type InsertEmail = z.infer<typeof insertEmailSchema>;
export type Email = typeof emails.$inferSelect;

export const savedImages = pgTable("saved_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  url: text("url").notNull(), // Base64 data URL
  productId: varchar("product_id"), // Optional product association
  provider: text("provider").notNull(), // 'gpt' | 'gemini25' | 'flux' | 'imagen4'
  prompt: text("prompt").notNull(), // Original prompt used
  revisedPrompt: text("revised_prompt"), // OpenAI's revised prompt (if available)
  referenceImageUrl: text("reference_image_url"), // Reference image used for generation (if any)
  sessionId: varchar("session_id"), // Links images from the same generation session
  status: text("status").default("saved"), // 'saved' for manually saved, 'auto-generated' for background generation
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSavedImageSchema = createInsertSchema(savedImages).omit({
  id: true,
  createdAt: true,
});

export type InsertSavedImage = z.infer<typeof insertSavedImageSchema>;
export type SavedImage = typeof savedImages.$inferSelect;

export const smsMessages = pgTable("sms_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  message: text("message").notNull(),
  type: text("type").notNull(), // 'sms' or 'mms'
  brand: text("brand").notNull(), // MyTacticalPromos, PatriotAddict, etc.
  productId: varchar("product_id").notNull(),
  angle: text("angle"), // Optional wording style insight
  aiProvider: text("ai_provider").notNull(), // 'claude' or 'gpt'
  characterCount: integer("character_count").notNull(), // With tag conversions
  status: text("status").default("draft"), // draft, active, archived
  notes: text("notes"),
  edited: integer("edited").default(0),
  originalMessage: text("original_message"),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSmsMessageSchema = createInsertSchema(smsMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertSmsMessage = z.infer<typeof insertSmsMessageSchema>;
export type SmsMessage = typeof smsMessages.$inferSelect;

export const savedVideos = pgTable("saved_videos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  url: text("url").notNull(), // Video URL from Sora/Veo
  productId: varchar("product_id"), // Optional product association
  provider: text("provider").notNull(), // 'sora-2' | 'sora-2-pro' | 'veo-2' | 'veo-3' | etc.
  prompt: text("prompt").notNull(), // Original text prompt used
  generationType: text("generation_type").notNull(), // 'text-to-video' | 'image-to-video' | 'reference-to-video'
  duration: integer("duration").notNull(), // Video length in seconds (default 8)
  aspectRatio: text("aspect_ratio"), // '16:9' | '9:16' | '1:1'
  referenceImageUrls: text("reference_image_urls").array(), // Reference images used (up to 3)
  sessionId: varchar("session_id"), // Links videos from the same generation session
  status: text("status").default("saved"), // 'saved' for manually saved, 'auto-generated' for background generation
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSavedVideoSchema = createInsertSchema(savedVideos).omit({
  id: true,
  createdAt: true,
});

export type InsertSavedVideo = z.infer<typeof insertSavedVideoSchema>;
export type SavedVideo = typeof savedVideos.$inferSelect;

export const rateLimits = pgTable("rate_limits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelName: text("model_name").notNull().unique(), // 'veo-3.1', 'veo-3.1-fast', 'veo-3', 'veo-3-fast', 'veo-2', 'flux'
  lastHitAt: timestamp("last_hit_at"), // When 429 error occurred
  resetsAt: timestamp("resets_at"), // 3:00 AM EST next day
  isCapped: integer("is_capped").default(0), // 0 = available, 1 = capped
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRateLimitSchema = createInsertSchema(rateLimits).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRateLimit = z.infer<typeof insertRateLimitSchema>;
export type RateLimit = typeof rateLimits.$inferSelect;

export const gifConversions = pgTable("gif_conversions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceVideoUrl: text("source_video_url").notNull(), // Original video URL
  cropX: integer("crop_x").default(0), // Crop offset X (pixels)
  cropY: integer("crop_y").default(0), // Crop offset Y (pixels)
  cropWidth: integer("crop_width"), // Crop width (null = full width)
  cropHeight: integer("crop_height"), // Crop height (null = full height)
  startTime: real("start_time").default(0), // Start time in seconds
  endTime: real("end_time"), // End time in seconds (null = full duration)
  duration: real("duration"), // Final output duration in seconds (null until completed)
  outputFormat: text("output_format").notNull(), // 'gif' | 'webp'
  quality: integer("quality").default(80), // Quality 1-100
  fps: integer("fps").default(15), // Frames per second
  width: integer("width"), // Output width (null = maintain aspect ratio)
  height: integer("height"), // Output height (null = maintain aspect ratio)
  outputUrl: text("output_url"), // Result URL (null until completed)
  fileSize: integer("file_size"), // File size in bytes (null until completed)
  status: text("status").default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
  errorMessage: text("error_message"), // Error details if failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertGifConversionSchema = createInsertSchema(gifConversions).omit({
  id: true,
  createdAt: true,
});

export type InsertGifConversion = z.infer<typeof insertGifConversionSchema>;
export type GifConversion = typeof gifConversions.$inferSelect;

export const mtpFolders = pgTable("mtp_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  parentId: varchar("parent_id"), // null = root folder
  shareCode: varchar("share_code").unique(), // for shareable links
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMtpFolderSchema = createInsertSchema(mtpFolders).omit({
  id: true,
  createdAt: true,
});

export type InsertMtpFolder = z.infer<typeof insertMtpFolderSchema>;
export type MtpFolder = typeof mtpFolders.$inferSelect;

export const mtpImageFolders = pgTable("mtp_image_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  imageKey: text("image_key").notNull(), // R2 object key
  folderId: varchar("folder_id").notNull(), // References mtpFolders.id
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMtpImageFolderSchema = createInsertSchema(mtpImageFolders).omit({
  id: true,
  createdAt: true,
});

export type InsertMtpImageFolder = z.infer<typeof insertMtpImageFolderSchema>;
export type MtpImageFolder = typeof mtpImageFolders.$inferSelect;

// MTP Naming Convention Tables
export const mtpNamingCategories = pgTable("mtp_naming_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMtpNamingCategorySchema = createInsertSchema(mtpNamingCategories).omit({
  id: true,
  createdAt: true,
});

export type InsertMtpNamingCategory = z.infer<typeof insertMtpNamingCategorySchema>;
export type MtpNamingCategory = typeof mtpNamingCategories.$inferSelect;

export const mtpNamingProductIds = pgTable("mtp_naming_product_ids", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMtpNamingProductIdSchema = createInsertSchema(mtpNamingProductIds).omit({
  id: true,
  createdAt: true,
});

export type InsertMtpNamingProductId = z.infer<typeof insertMtpNamingProductIdSchema>;
export type MtpNamingProductId = typeof mtpNamingProductIds.$inferSelect;

export const mtpNamingTypes = pgTable("mtp_naming_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  displayName: text("display_name"),
  categoryId: varchar("category_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMtpNamingTypeSchema = createInsertSchema(mtpNamingTypes).omit({
  id: true,
  createdAt: true,
});

export type InsertMtpNamingType = z.infer<typeof insertMtpNamingTypeSchema>;
export type MtpNamingType = typeof mtpNamingTypes.$inferSelect;
