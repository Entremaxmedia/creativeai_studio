// Video generation model registry with capabilities
export type GenerationType = 
  | 'text-to-video'
  | 'image-to-video'
  | 'video-extension'
  | 'reference-images'
  | 'first-last-frames';

export interface ModelDefinition {
  id: string; // Model identifier for API
  name: string; // Display name
  provider: 'kie' | 'google' | 'openai'; // API provider
  description: string; // Brief description
  order: number; // Selection priority (1 = auto-selected first, higher = lower priority)
  displayOrder: number; // Display order in UI (1 = top, higher = bottom)
  isImplemented: boolean; // Whether model is fully implemented
  supportedGenerationTypes: GenerationType[];
  maxDuration: number; // Maximum video duration in seconds
  minDuration: number; // Minimum video duration in seconds
  maxVariations: number; // Maximum number of variations
  defaultDuration: number; // Recommended duration
  allowedDurations?: number[]; // Discrete duration options (if set, only these values are allowed)
  notes?: string; // Additional notes about capabilities
}

export const VIDEO_MODELS: Record<string, ModelDefinition> = {
  'sora-2-pro': {
    id: 'sora-2-pro',
    name: 'Sora 2 Pro',
    provider: 'openai',
    description: 'Enhanced Sora 2 with native audio sync, refined physics, and superior quality',
    order: 1, // Highest selection priority (auto-selected first)
    displayOrder: 6, // Display near bottom (before standard Sora 2)
    isImplemented: true,
    supportedGenerationTypes: ['text-to-video', 'image-to-video', 'video-extension'],
    maxDuration: 15,
    minDuration: 4,
    maxVariations: 4,
    defaultDuration: 8,
    notes: 'Premium quality with native audio, supports up to 15 seconds in 1080p HD'
  },
  'sora-2': {
    id: 'sora-2',
    name: 'Sora 2',
    provider: 'openai',
    description: 'OpenAI Sora 2 with cinematic quality and long video support',
    order: 2, // Second priority
    displayOrder: 7, // Display at bottom
    isImplemented: true,
    supportedGenerationTypes: ['text-to-video', 'image-to-video', 'video-extension'],
    maxDuration: 25,
    minDuration: 4,
    maxVariations: 4,
    defaultDuration: 8,
    notes: 'Supports up to 25 seconds'
  },
  'veo-3.1': {
    id: 'veo-3.1',
    name: 'Veo 3.1',
    provider: 'kie',
    description: 'Latest Veo model with highest quality and best prompt adherence',
    order: 2,
    displayOrder: 1, // Display at top
    isImplemented: true,
    supportedGenerationTypes: ['text-to-video', 'image-to-video', 'first-last-frames'],
    maxDuration: 8,
    minDuration: 4,
    maxVariations: 4,
    defaultDuration: 6,
    notes: 'Best quality, supports first-last frames'
  },
  'veo-3.1-fast': {
    id: 'veo-3.1-fast',
    name: 'Veo 3.1 Fast',
    provider: 'kie',
    description: 'Faster Veo 3.1 variant with good quality and quick generation',
    order: 3,
    displayOrder: 2,
    isImplemented: true,
    supportedGenerationTypes: ['text-to-video', 'image-to-video', 'reference-images', 'first-last-frames'],
    maxDuration: 8,
    minDuration: 4,
    maxVariations: 4,
    defaultDuration: 6,
    notes: 'Faster generation, supports reference images and first-last frames'
  },
  'veo-3': {
    id: 'veo-3',
    name: 'Veo 3',
    provider: 'kie',
    description: 'Veo 3 with excellent quality and creative control',
    order: 4,
    displayOrder: 3,
    isImplemented: true,
    supportedGenerationTypes: ['text-to-video', 'image-to-video', 'first-last-frames'],
    maxDuration: 8,
    minDuration: 4,
    maxVariations: 4,
    defaultDuration: 6,
    notes: 'Supports first-last frames'
  },
  'veo-3-fast': {
    id: 'veo-3-fast',
    name: 'Veo 3 Fast',
    provider: 'kie',
    description: 'Faster Veo 3 with balanced quality and speed',
    order: 5,
    displayOrder: 4,
    isImplemented: true,
    supportedGenerationTypes: ['text-to-video', 'image-to-video', 'first-last-frames', 'reference-images'],
    maxDuration: 8,
    minDuration: 4,
    maxVariations: 4,
    defaultDuration: 6,
    notes: 'Quick generation, supports reference images and first-last frames'
  },
  'veo-2': {
    id: 'veo-2',
    name: 'Veo 2',
    provider: 'google',
    description: 'Previous generation Veo model with reliable performance',
    order: 6,
    displayOrder: 5,
    isImplemented: true,
    supportedGenerationTypes: ['text-to-video', 'image-to-video'],
    maxDuration: 8,
    minDuration: 4,
    maxVariations: 4,
    defaultDuration: 6,
    notes: 'Reliable fallback option'
  },
  'kling-2.6': {
    id: 'kling-2.6',
    name: 'Kling 2.6',
    provider: 'kie',
    description: 'Kling AI 2.6 with native audio sync, speech, and sound effects',
    order: 3,
    displayOrder: 0,
    isImplemented: true,
    supportedGenerationTypes: ['text-to-video', 'image-to-video'],
    maxDuration: 10,
    minDuration: 5,
    maxVariations: 4,
    defaultDuration: 5,
    allowedDurations: [5, 10],
    notes: 'Supports native audio generation with speech and ambient sound (5s or 10s only)'
  }
};

export const GENERATION_TYPE_CONFIGS: Record<GenerationType, {
  label: string;
  description: string;
  requiresImage: boolean;
  requiresMultipleImages: boolean;
  requiresVideo: boolean;
  minImages?: number; // Minimum number of images required
  maxImages?: number; // Maximum number of images allowed
}> = {
  'text-to-video': {
    label: 'Text to Video',
    description: 'Generate video from text prompt only',
    requiresImage: false,
    requiresMultipleImages: false,
    requiresVideo: false
  },
  'image-to-video': {
    label: 'Image to Video',
    description: 'Animate a single image into a video',
    requiresImage: true,
    requiresMultipleImages: false,
    requiresVideo: false,
    minImages: 1,
    maxImages: 1
  },
  'video-extension': {
    label: 'Video Extension',
    description: 'Extend an existing video with new content',
    requiresImage: false,
    requiresMultipleImages: false,
    requiresVideo: true
  },
  'reference-images': {
    label: 'Reference Images',
    description: 'Generate video using multiple reference images (up to 3)',
    requiresImage: false,
    requiresMultipleImages: true,
    requiresVideo: false,
    minImages: 1,
    maxImages: 3
  },
  'first-last-frames': {
    label: 'First & Last Frames',
    description: 'Generate video between two keyframes',
    requiresImage: false,
    requiresMultipleImages: true,
    requiresVideo: false,
    minImages: 2,
    maxImages: 2
  }
};

// Helper to get available models for a generation type
export function getModelsForGenerationType(generationType: GenerationType): ModelDefinition[] {
  return Object.values(VIDEO_MODELS)
    .filter(model => model.supportedGenerationTypes.includes(generationType))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

// Helper to get duration constraints for selected models
export function getDurationConstraints(modelIds: string[]): {
  minDuration: number;
  maxDuration: number;
  defaultDuration: number;
} {
  const models = modelIds.map(id => VIDEO_MODELS[id]).filter(Boolean);
  
  if (models.length === 0) {
    return { minDuration: 4, maxDuration: 8, defaultDuration: 6 };
  }
  
  return {
    minDuration: Math.max(...models.map(m => m.minDuration)),
    maxDuration: Math.min(...models.map(m => m.maxDuration)),
    defaultDuration: Math.max(...models.map(m => m.defaultDuration))
  };
}

// Helper to get variation constraints for selected models
export function getVariationConstraints(modelIds: string[]): {
  maxVariations: number;
} {
  const models = modelIds.map(id => VIDEO_MODELS[id]).filter(Boolean);
  
  if (models.length === 0) {
    return { maxVariations: 4 };
  }
  
  return {
    maxVariations: Math.min(...models.map(m => m.maxVariations))
  };
}
