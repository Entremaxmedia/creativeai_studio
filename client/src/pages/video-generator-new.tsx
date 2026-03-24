import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, X, Loader2, InfoIcon, Save, Download, Sparkles, ChevronDown, Check, ChevronsUpDown, FolderOpen } from "lucide-react";
import MtpImagePicker from "@/components/mtp-image-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Product } from "@shared/schema";
import type { GenerationType } from "@shared/videoModels";
import { uploadToStorage, getStorageUrl, cacheVideo, getVideoCache, clearVideoCache, type CachedVideo } from "@/lib/storageCache";
import { useLocation } from "wouter";
import VideoPromptHelper from "@/components/video-generator/video-prompt-helper";

const STORAGE_KEY_PREFIX = "video-generator-";
const STORAGE_KEYS = {
  state: 'videoGeneratorState',
  pendingSessionId: `${STORAGE_KEY_PREFIX}pending-session`,
} as const;

interface VideoModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  order: number; // Selection priority
  displayOrder: number; // Display order
  isImplemented: boolean; // Whether model is fully implemented
  supportedGenerationTypes: GenerationType[];
  maxDuration: number;
  minDuration: number;
  maxVariations: number;
  defaultDuration: number;
  allowedDurations?: number[]; // Discrete duration options (if set, only these values allowed)
  notes?: string;
  isAvailable: boolean;
  unavailableUntil: string | null;
  unavailableMessage: string | null;
}

interface GenerationTypeConfig {
  label: string;
  description: string;
  requiresImage: boolean;
  requiresMultipleImages: boolean;
  requiresVideo: boolean;
  minImages?: number;
  maxImages?: number;
}

interface VideoSuggestions {
  lifestyle: string[];
  product: string[];
  ugc: string[];
  review: string[];
}

export default function VideoGeneratorNew() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const isInitialMount = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load initial state from localStorage (lazy initialization to prevent race conditions)
  const getInitialState = () => {
    try {
      const saved = localStorage.getItem('videoGeneratorState');
      if (saved) {
        const state = JSON.parse(saved);
        return state;
      }
    } catch (error) {
      console.error("Failed to load initial video generator state:", error);
    }
    return null;
  };
  
  const initialState = getInitialState();

  // Configuration state
  const [selectedProductId] = useState<string>("none");
  const [generationType, setGenerationType] = useState<GenerationType>(initialState?.generationType || 'text-to-video');
  const [promptDetails, setPromptDetails] = useState<string>(initialState?.promptDetails || "");
  const [duration, setDuration] = useState<number>(initialState?.duration || 6);
  const [amount, setAmount] = useState<number>(initialState?.amount || 1);
  const [aspectRatio, setAspectRatio] = useState<string>(initialState?.aspectRatio || "16:9");
  
  // AI suggestions state
  const [suggestions, setSuggestions] = useState<VideoSuggestions | null>(initialState?.suggestions || null);
  const [streamingSuggestions, setStreamingSuggestions] = useState<VideoSuggestions>({
    lifestyle: [],
    product: [],
    ugc: [],
    review: []
  });
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  
  // Model selection state
  const [selectedModels, setSelectedModels] = useState<string[]>(initialState?.selectedModels || ['sora-2']);
  
  // Reference media state
  const [referenceImages, setReferenceImages] = useState<string[]>(initialState?.referenceImages || []);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceVideo, setReferenceVideo] = useState<string | null>(null);
  const [referenceVideoFile, setReferenceVideoFile] = useState<File | null>(null);
  const [mtpPickerOpen, setMtpPickerOpen] = useState(false);
  
  // UI state
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
    return localStorage.getItem(STORAGE_KEYS.pendingSessionId) ? "Checking for your videos..." : "";
  });
  
  // Save state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveProductId, setSaveProductId] = useState<string>("none");
  const [saveProductSearchOpen, setSaveProductSearchOpen] = useState(false);
  const [videoToSave, setVideoToSave] = useState<{
    url: string;
    modelName: string;
    modelId: string;
    variationIndex: number;
    prompt: string;
    generationType: string;
    duration: number;
    aspectRatio: string;
    referenceImageUrls: string[];
    productId: string;
  } | null>(null);

  // Fetch products
  const { data: productsData } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ["/api/products"],
  });

  // Fetch video models based on generation type
  const { data: modelsData } = useQuery<{
    success: boolean;
    models: VideoModel[];
    generationTypes: Record<GenerationType, GenerationTypeConfig>;
  }>({
    queryKey: ['/api/video-models', generationType],
    queryFn: async () => {
      const res = await fetch(`/api/video-models?generationType=${generationType}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch video models');
      }
      return await res.json();
    },
    enabled: true,
  });

  const products = productsData?.products || [];
  const availableModels = modelsData?.models || [];
  const generationTypes = modelsData?.generationTypes || {} as Record<GenerationType, GenerationTypeConfig>;
  const currentGenTypeConfig = generationType ? generationTypes[generationType] : undefined;

  // Calculate duration constraints based on selected models
  const durationConstraints = (() => {
    if (selectedModels.length === 0) {
      return { minDuration: 4, maxDuration: 8, allowedDurations: null as number[] | null };
    }
    
    const selectedModelDefs = selectedModels
      .map(id => availableModels.find(m => m.id === id))
      .filter((m): m is VideoModel => m !== undefined);
    
    // If no models found (e.g., data not loaded yet), use defaults
    if (selectedModelDefs.length === 0) {
      return { minDuration: 4, maxDuration: 8, allowedDurations: null as number[] | null };
    }
    
    // Calculate min/max across all selected models
    const minDuration = Math.max(...selectedModelDefs.map(m => m.minDuration || 4));
    const maxDuration = Math.min(...selectedModelDefs.map(m => m.maxDuration || 8));
    
    // Find all models with discrete allowedDurations
    const modelsWithAllowed = selectedModelDefs.filter(m => m.allowedDurations && m.allowedDurations.length > 0);
    
    let allowedDurations: number[] | null = null;
    
    if (modelsWithAllowed.length > 0) {
      // Start with the first model's allowed durations
      let intersected = new Set(modelsWithAllowed[0].allowedDurations!);
      
      // Intersect with other models' allowed durations
      for (let i = 1; i < modelsWithAllowed.length; i++) {
        const modelAllowed = new Set(modelsWithAllowed[i].allowedDurations!);
        intersected = new Set([...intersected].filter(d => modelAllowed.has(d)));
      }
      
      // Filter by min/max constraints of all models (including those without allowedDurations)
      const validDurations = [...intersected].filter(d => d >= minDuration && d <= maxDuration).sort((a, b) => a - b);
      
      // Only use discrete mode if we have valid options
      if (validDurations.length > 0) {
        allowedDurations = validDurations;
      }
      // Otherwise fallback to range mode (allowedDurations stays null)
    }
    
    return { minDuration, maxDuration, allowedDurations };
  })();

  // Calculate variation constraints based on selected models
  const maxVariationsAllowed = selectedModels.length > 0
    ? Math.min(...selectedModels.map(id => {
        const model = availableModels.find(m => m.id === id);
        return model?.maxVariations || 4;
      }))
    : 4;

  // Load reference images from saved image IDs (for "Use for Video" feature)
  useEffect(() => {
    const loadReferenceImagesFromIds = async () => {
      if (initialState?.referenceImageIds && Array.isArray(initialState.referenceImageIds) && initialState.referenceImageIds.length > 0) {
        try {
          const response = await fetch('/api/saved-images/by-ids', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: initialState.referenceImageIds }),
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.images && data.images.length > 0) {
              // Extract URLs from the fetched images
              const imageUrls = data.images.map((img: { url: string }) => img.url);
              setReferenceImages(imageUrls);
              
              // Clear the IDs from localStorage now that we've loaded them
              const currentState = JSON.parse(localStorage.getItem('videoGeneratorState') || '{}');
              delete currentState.referenceImageIds;
              currentState.referenceImages = imageUrls;
              localStorage.setItem('videoGeneratorState', JSON.stringify(currentState));
            }
          }
        } catch (error) {
          console.error('Failed to load reference images from IDs:', error);
        }
      }
    };
    
    loadReferenceImagesFromIds();
  }, []); // Run once on mount

  // Reconcile selected models when generation type changes or available models update
  useEffect(() => {
    const validModelIds = new Set(availableModels.map(m => m.id));
    const currentlySelected = selectedModels.filter(id => validModelIds.has(id));
    
    // Only auto-select if some models became invalid (were filtered out)
    // Don't auto-select if user manually deselected all models
    if (currentlySelected.length === 0 && selectedModels.length > 0 && availableModels.length > 0) {
      // Models were filtered out due to generation type change - auto-select first available
      const sortedByPriority = [...availableModels].sort((a, b) => a.order - b.order);
      const firstAvailable = sortedByPriority.find(m => m.isAvailable && m.isImplemented);
      if (firstAvailable) {
        setSelectedModels([firstAvailable.id]);
      }
    } else if (currentlySelected.length > 0 && currentlySelected.length !== selectedModels.length) {
      // Some models were invalid, update to only valid ones
      setSelectedModels(currentlySelected);
    }
  }, [availableModels, generationType]); // Intentionally omit selectedModels to avoid infinite loop

  // Adjust duration if it's outside the constraints or not in allowed list
  useEffect(() => {
    if (durationConstraints.allowedDurations) {
      // For models with discrete duration options, snap to the nearest allowed value
      if (!durationConstraints.allowedDurations.includes(duration)) {
        // Find the closest allowed duration
        const closest = durationConstraints.allowedDurations.reduce((prev, curr) => 
          Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev
        );
        setDuration(closest);
      }
    } else {
      // Standard min/max constraints
      if (duration < durationConstraints.minDuration) {
        setDuration(durationConstraints.minDuration);
      } else if (duration > durationConstraints.maxDuration) {
        setDuration(durationConstraints.maxDuration);
      }
    }
  }, [durationConstraints, duration]);

  // Adjust variations if it exceeds the max
  useEffect(() => {
    if (amount > maxVariationsAllowed) {
      setAmount(maxVariationsAllowed);
    }
  }, [maxVariationsAllowed, amount]);

  // Convert reference images from URLs to File objects (for "Use for Video" feature)
  useEffect(() => {
    const convertUrlsToFiles = async () => {
      if (referenceImages.length > 0 && referenceImageFiles.length === 0) {
        const files: File[] = [];
        for (let i = 0; i < referenceImages.length; i++) {
          const url = referenceImages[i];
          try {
            let blob: Blob;
            
            if (url.startsWith('data:image/')) {
              // Handle data URLs (base64)
              const response = await fetch(url);
              blob = await response.blob();
            } else if (url.startsWith('/storage/') || url.startsWith('http')) {
              // Handle regular URLs - fetch the image first
              const response = await fetch(url);
              if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
              blob = await response.blob();
            } else {
              console.warn('Unknown URL format, skipping:', url);
              continue;
            }
            
            const file = new File([blob], `reference-image-${i}.png`, { type: blob.type });
            files.push(file);
          } catch (error) {
            console.error('Failed to convert URL to File:', error);
          }
        }
        if (files.length > 0) {
          setReferenceImageFiles(files);
        }
      }
    };
    convertUrlsToFiles();
  }, [referenceImages, referenceImageFiles.length]);

  // Handle model checkbox toggle
  const toggleModel = (modelId: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelId)) {
        // Allow deselecting - validation happens at generation time
        return prev.filter(id => id !== modelId);
      } else {
        return [...prev, modelId].sort((a, b) => {
          const modelA = availableModels.find(m => m.id === a);
          const modelB = availableModels.find(m => m.id === b);
          return (modelA?.order || 999) - (modelB?.order || 999);
        });
      }
    });
  };

  // Handle image uploads (for multiple images)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxImages = currentGenTypeConfig?.maxImages || 3;
    
    if (referenceImages.length + files.length > maxImages) {
      toast({
        title: "Too many images",
        description: `This generation type supports up to ${maxImages} image(s).`,
        variant: "destructive"
      });
      return;
    }

    const newImagePromises = files.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(newImagePromises).then(newImages => {
      setReferenceImages(prev => [...prev, ...newImages]);
      setReferenceImageFiles(prev => [...prev, ...files]);
    });
  };

  // Handle video upload
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setReferenceVideo(reader.result as string);
      setReferenceVideoFile(file);
    };
    reader.readAsDataURL(file);
  };

  // Remove reference image
  const removeReferenceImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
    setReferenceImageFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Remove reference video
  const removeReferenceVideo = () => {
    setReferenceVideo(null);
    setReferenceVideoFile(null);
  };

  // Handle MTP image selection
  const handleMtpImageSelect = async (image: { url: string; key: string }) => {
    const maxImages = currentGenTypeConfig?.maxImages || 1;
    if (referenceImages.length >= maxImages) {
      toast({
        title: "Maximum images reached",
        description: `You can only add up to ${maxImages} image${maxImages > 1 ? 's' : ''}`,
        variant: "destructive",
      });
      return;
    }
    
    try {
      // Use proxy endpoint to avoid CORS issues with R2
      const proxyUrl = `/api/mtp-images/proxy/${encodeURIComponent(image.key)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch image');
      }
      const blob = await response.blob();
      const file = new File([blob], image.key.split('/').pop() || 'mtp-image.png', { type: blob.type });
      
      const reader = new FileReader();
      reader.onloadend = () => {
        // Double-check limit inside callback to prevent race conditions
        setReferenceImages(prev => {
          if (prev.length >= maxImages) return prev;
          return [...prev, reader.result as string];
        });
        setReferenceImageFiles(prev => {
          if (prev.length >= maxImages) return prev;
          return [...prev, file];
        });
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("MTP image load error:", error);
      toast({
        title: "Error",
        description: "Failed to load image from MTP library",
        variant: "destructive",
      });
    }
  };

  // State for generated videos (now persisted via storage + localStorage cache)
  const [generatedVideos, setGeneratedVideos] = useState<Record<string, { 
    url: string; 
    modelName: string; 
    variationIndex: number;
    // Immutable metadata from generation
    prompt: string;
    generationType: string;
    duration: number;
    aspectRatio: string;
    referenceImageUrls: string[];
    productId: string;
    isLoaded?: boolean; // Whether video is loaded from storage (true) or placeholder (false)
  }[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load cached videos from localStorage on mount
  useEffect(() => {
    const cache = getVideoCache();
    const loadedVideos: typeof generatedVideos = {};
    
    for (const [modelId, videos] of Object.entries(cache)) {
      loadedVideos[modelId] = videos.map(v => ({
        url: '', // Placeholder - will be loaded on demand
        modelName: v.modelName,
        variationIndex: v.variationIndex,
        prompt: v.prompt,
        generationType: v.generationType,
        duration: v.duration,
        aspectRatio: v.aspectRatio,
        referenceImageUrls: [],
        productId: v.productId,
        isLoaded: false, // Not yet loaded from storage
      }));
    }
    
    if (Object.keys(loadedVideos).length > 0) {
      setGeneratedVideos(loadedVideos);
    }
  }, []);

  // Persist state to localStorage whenever it changes
  useEffect(() => {
    try {
      const state = {
        selectedProductId,
        generationType,
        promptDetails,
        duration,
        amount,
        aspectRatio,
        suggestions,
        selectedModels,
      };
      localStorage.setItem('videoGeneratorState', JSON.stringify(state));
    } catch (error) {
      // QuotaExceeded errors are handled silently - app continues functioning
      console.warn("Failed to persist video generator state:", error);
    }
  }, [selectedProductId, generationType, promptDetails, duration, amount, aspectRatio, suggestions, selectedModels]);

  // Simple cleanup: Clear sessionId after videos have been displayed for 3 seconds
  useEffect(() => {
    const hasVideos = Object.keys(generatedVideos).length > 0;
    const notGenerating = !isGenerating;
    
    if (hasVideos && notGenerating) {
      // User has viewed videos for a bit, clear the session
      const timer = setTimeout(() => {
        const pendingSessionId = localStorage.getItem(STORAGE_KEYS.pendingSessionId);
        if (pendingSessionId) {
          localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
          console.log("[Video Gen] Cleared pending sessionId after videos displayed");
        }
      }, 3000); // Wait 3 seconds before clearing
      
      return () => clearTimeout(timer);
    }
  }, [isGenerating, generatedVideos]);

  // Recovery useEffect - check for pending sessions on mount
  useEffect(() => {
    const recoverPendingSession = async () => {
      const pendingSessionId = localStorage.getItem(STORAGE_KEYS.pendingSessionId);
      
      if (!pendingSessionId || !isInitialMount.current) {
        isInitialMount.current = false;
        return;
      }

      console.log("[Video Gen] Found pending session, attempting recovery:", pendingSessionId);
      
      // Clear old videos and show generating state
      setGeneratedVideos({});
      setErrors({});
      setIsGenerating(true);
      setGenerationStatus("Checking for your videos...");
      setGenerationProgress(50);

      try {
        // Create abort controller for recovery polling
        abortControllerRef.current = new AbortController();
        
        // Poll for videos up to 2 minutes (24 attempts * 5 seconds)
        const maxAttempts = 24;
        let attempts = 0;
        let videosFound = false;

        while (attempts < maxAttempts && !videosFound && !abortControllerRef.current.signal.aborted) {
          attempts++;
          console.log(`[Video Gen] Recovery attempt ${attempts}/${maxAttempts}`);
          
          const progressPercent = 50 + Math.floor((attempts / maxAttempts) * 45); // 50% to 95%
          setGenerationProgress(progressPercent);
          setGenerationStatus(attempts === 1 ? 
            "Your videos are still being generated... this usually takes 60-120 seconds" : 
            `Still generating your videos... (${Math.floor(attempts * 5)}s elapsed)`
          );

          const response = await fetch(`/api/videos/session/${pendingSessionId}`, {
            signal: abortControllerRef.current.signal,
          });
          const data = await response.json();

          if (data.success && data.videos && data.videos.length > 0) {
            console.log(`[Video Gen] Recovered ${data.videos.length} videos from session`);
            videosFound = true;

            // Group videos by provider
            const videosByModel: Record<string, typeof generatedVideos[string]> = {};

            data.videos.forEach((vid: any) => {
              const modelId = vid.provider; // Use provider as modelId
              if (!videosByModel[modelId]) {
                videosByModel[modelId] = [];
              }

              videosByModel[modelId].push({
                url: vid.url,
                modelName: vid.provider,
                variationIndex: videosByModel[modelId].length,
                prompt: vid.prompt,
                generationType: vid.generationType,
                duration: vid.duration,
                aspectRatio: vid.aspectRatio || '16:9',
                referenceImageUrls: vid.referenceImageUrls || [],
                productId: vid.productId || 'none',
                isLoaded: true,
              });
            });

            setGeneratedVideos(videosByModel);
            
            setGenerationProgress(100);
            setGenerationStatus("Complete!");

            toast({
              title: "Videos Recovered",
              description: `Successfully recovered ${data.videos.length} videos.`,
            });

            // Reset generating state after brief delay
            setTimeout(() => {
              setIsGenerating(false);
              setGenerationProgress(0);
              setGenerationStatus("");
            }, 500);
          } else if (attempts < maxAttempts && !abortControllerRef.current.signal.aborted) {
            // Wait 5 seconds before next attempt
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(resolve, 5000);
              abortControllerRef.current?.signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(new DOMException('Aborted', 'AbortError'));
              });
            });
          }
        }
        
        // Check if cancelled
        if (abortControllerRef.current.signal.aborted) {
          console.log("[Video Gen] Recovery cancelled by user");
          localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
          setIsGenerating(false);
          setGenerationProgress(0);
          setGenerationStatus("");
          toast({
            title: "Generation Cancelled",
            description: "Video generation recovery was cancelled successfully",
          });
          return;
        }

        if (!videosFound) {
          console.log("[Video Gen] Recovery timeout - no videos found after", maxAttempts, "attempts");
          
          // Clear the pending session to prevent infinite loop
          localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
          
          setIsGenerating(false);
          setGenerationProgress(0);
          setGenerationStatus("");

          toast({
            title: "Generation Timeout",
            description: "Unable to recover videos. Please try generating again.",
            variant: "destructive",
          });
        }
      } catch (error: any) {
        console.error("[Video Gen] Error recovering session:", error);
        
        // Check if the error was due to cancellation
        if (error.name === 'AbortError') {
          console.log("[Video Gen] Recovery cancelled");
          toast({
            title: "Generation Cancelled",
            description: "Video generation recovery was cancelled successfully",
          });
        } else {
          toast({
            title: "Recovery Error",
            description: "Failed to recover videos. Please try generating again.",
            variant: "destructive",
          });
        }
        
        // Clear the pending session to prevent infinite loop
        localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
        
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");
      } finally {
        isInitialMount.current = false;
        abortControllerRef.current = null;
      }
    };

    recoverPendingSession();
  }, []); // Only run on mount

  // Load video from storage
  const handleLoadVideo = async (modelId: string, variationIndex: number) => {
    const cache = getVideoCache();
    const cachedVideo = cache[modelId]?.[variationIndex];
    
    if (!cachedVideo) {
      toast({
        title: "Video not found",
        description: "Could not find cached video data.",
        variant: "destructive"
      });
      return;
    }
    
    try {
      // Fetch from storage
      const storageUrl = getStorageUrl(cachedVideo.storagePath);
      
      setGeneratedVideos(prev => ({
        ...prev,
        [modelId]: prev[modelId].map((v, idx) => 
          idx === variationIndex
            ? { ...v, url: storageUrl, isLoaded: true }
            : v
        )
      }));
      
      toast({
        title: "Video Loaded",
        description: "Video loaded from storage successfully.",
      });
    } catch (error) {
      console.error('[Video Gen] Failed to load from storage:', error);
      toast({
        title: "Load Failed",
        description: "Failed to load video from storage.",
        variant: "destructive"
      });
    }
  };

  // Save video mutation
  const saveMutation = useMutation({
    mutationFn: async (data: {
      url: string;
      productId: string | null;
      provider: string;
      prompt: string;
      generationType: string;
      duration: number;
      aspectRatio: string;
      referenceImageUrls: string[];
    }) => {
      return await apiRequest("POST", "/api/videos/save", data);
    },
    onSuccess: () => {
      toast({
        title: "Video Saved!",
        description: "The video has been saved to your library.",
      });
      setSaveDialogOpen(false);
      setVideoToSave(null);
      setSaveProductId("none");
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save video to library.",
        variant: "destructive"
      });
    }
  });

  // AI suggestions mutation with streaming for faster perceived performance
  const suggestionsMutation = useMutation({
    mutationFn: async (productId: string) => {
      setIsStreaming(true);
      setStreamingSuggestions({
        lifestyle: [],
        product: [],
        ugc: [],
        review: []
      });
      
      return new Promise((resolve, reject) => {
        let accumulatedContent = '';
        let jsonBuffer = '';
        
        fetch('/api/generate-video-suggestions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ productId })
        }).then(response => {
          if (!response.ok) {
            throw new Error('Failed to generate suggestions');
          }
          
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          
          if (!reader) {
            throw new Error('No response body');
          }
          
          const readStream = async () => {
            let buffer = '';
            
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) break;
              
              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;
              
              // Split by double newline (SSE message separator)
              const messages = buffer.split('\n\n');
              // Keep the last (potentially incomplete) message in the buffer
              buffer = messages.pop() || '';
              
              for (const message of messages) {
                const lines = message.split('\n');
                
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    try {
                      const data = JSON.parse(line.slice(6));
                      
                      if (data.type === 'progress') {
                        accumulatedContent += data.content;
                        jsonBuffer += data.content;
                        
                        // Try to extract complete suggestion objects from the buffer
                        const suggestionPattern = /"prompt":\s*"([^"\\]*(\\.[^"\\]*)*)"/g;
                        let match;
                        const currentSuggestions: VideoSuggestions = {
                          lifestyle: [],
                          product: [],
                          ugc: [],
                          review: []
                        };
                        
                        // Extract all complete prompts from the accumulated JSON
                        while ((match = suggestionPattern.exec(jsonBuffer)) !== null) {
                          const prompt = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
                          
                          // Determine category based on position in the buffer
                          const beforeMatch = jsonBuffer.substring(0, match.index);
                          if (beforeMatch.includes('"lifestyle"')) {
                            if (!currentSuggestions.lifestyle.includes(prompt)) {
                              currentSuggestions.lifestyle.push(prompt);
                            }
                          } else if (beforeMatch.includes('"product"')) {
                            if (!currentSuggestions.product.includes(prompt)) {
                              currentSuggestions.product.push(prompt);
                            }
                          } else if (beforeMatch.includes('"ugc"')) {
                            if (!currentSuggestions.ugc.includes(prompt)) {
                              currentSuggestions.ugc.push(prompt);
                            }
                          } else if (beforeMatch.includes('"review"')) {
                            if (!currentSuggestions.review.includes(prompt)) {
                              currentSuggestions.review.push(prompt);
                            }
                          }
                        }
                        
                        setStreamingSuggestions(currentSuggestions);
                      } else if (data.type === 'complete') {
                        setIsStreaming(false);
                        setStreamingSuggestions({
                          lifestyle: [],
                          product: [],
                          ugc: [],
                          review: []
                        });
                        resolve({ suggestions: data.suggestions, requestedProductId: productId });
                        return;
                      } else if (data.type === 'error') {
                        setIsStreaming(false);
                        setStreamingSuggestions({
                          lifestyle: [],
                          product: [],
                          ugc: [],
                          review: []
                        });
                        reject(new Error(data.error));
                        return;
                      }
                    } catch (e) {
                      console.error('[Suggestions] Failed to parse SSE data:', e);
                    }
                  }
                }
              }
            }
          };
          
          readStream().catch(reject);
        }).catch(reject);
      });
    },
    onSuccess: (data: any) => {
      // Only apply suggestions if they match the currently selected product (prevents race conditions)
      if (data.requestedProductId === selectedProductId) {
        setSuggestions(data.suggestions);
        toast({
          title: "Suggestions Generated",
          description: "AI-powered video prompts are ready below.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Generate Suggestions",
        description: error.message || "Unable to generate suggestions at this time.",
        variant: "destructive"
      });
    }
  });

  // Generate suggestions when product is selected (skip on initial mount to allow localStorage restoration)
  useEffect(() => {
    // Skip on initial mount to prevent auto-generation when state is being restored from localStorage
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    // Clear old suggestions immediately when product changes
    setSuggestions(null);
    setStreamingSuggestions({
      lifestyle: [],
      product: [],
      ugc: [],
      review: [],
    });
    
    if (selectedProductId && selectedProductId !== 'none') {
      suggestionsMutation.mutate(selectedProductId);
    }
  }, [selectedProductId]);

  // Handle clicking a suggestion to use it as prompt
  const handleSuggestionClick = (suggestion: string) => {
    setPromptDetails(suggestion);
    toast({
      description: "Suggestion has been added to your prompt",
    });
  };

  // Handle save button click
  const handleSaveClick = (video: { 
    url: string; 
    modelName: string; 
    modelId: string;
    variationIndex: number;
    prompt: string;
    generationType: string;
    duration: number;
    aspectRatio: string;
    referenceImageUrls: string[];
    productId: string;
  }) => {
    setVideoToSave(video);
    setSaveDialogOpen(true);
  };

  // Handle confirm save
  const handleConfirmSave = () => {
    if (!videoToSave) return;

    const model = availableModels.find(m => m.id === videoToSave.modelId);
    const provider = model?.provider || 'unknown';

    // Get storage URL if available (prefer storage URL over data URI)
    const cache = getVideoCache();
    const cachedVideos = cache[videoToSave.modelId];
    const cachedVideo = cachedVideos?.find((v: CachedVideo) => 
      v.variationIndex === videoToSave.variationIndex
    );
    
    // Use storage URL if available, otherwise fall back to data URI
    const videoUrl = cachedVideo?.storagePath 
      ? getStorageUrl(cachedVideo.storagePath)
      : videoToSave.url;

    // Use immutable metadata from the video object, not current UI state
    saveMutation.mutate({
      url: videoUrl,
      productId: saveProductId === "none" ? null : saveProductId,
      provider: provider,
      prompt: videoToSave.prompt,
      generationType: videoToSave.generationType,
      duration: videoToSave.duration,
      aspectRatio: videoToSave.aspectRatio,
      referenceImageUrls: videoToSave.referenceImageUrls,
    });
  };

  // Handle save and download
  const handleSaveAndDownload = async () => {
    if (!videoToSave) return;

    const model = availableModels.find(m => m.id === videoToSave.modelId);
    const provider = model?.provider || 'unknown';

    try {
      // Get storage URL if available (prefer storage URL over data URI)
      const cache = getVideoCache();
      const cachedVideos = cache[videoToSave.modelId];
      const cachedVideo = cachedVideos?.find((v: CachedVideo) => 
        v.variationIndex === videoToSave.variationIndex
      );
      
      // Use storage URL if available, otherwise fall back to data URI
      const videoUrl = cachedVideo?.storagePath 
        ? getStorageUrl(cachedVideo.storagePath)
        : videoToSave.url;

      // First save to library using mutateAsync to wait for completion
      await saveMutation.mutateAsync({
        url: videoUrl,
        productId: saveProductId === "none" ? null : saveProductId,
        provider: provider,
        prompt: videoToSave.prompt,
        generationType: videoToSave.generationType,
        duration: videoToSave.duration,
        aspectRatio: videoToSave.aspectRatio,
        referenceImageUrls: videoToSave.referenceImageUrls,
      });

      // Only download after successful save
      const response = await fetch(videoUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `video-${provider}-${new Date().toISOString().split('T')[0]}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Success!",
        description: "Video saved to library and downloading to computer.",
      });

      setSaveDialogOpen(false);
      setVideoToSave(null);
      setSaveProductId("none");
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save and download video",
        variant: "destructive",
      });
    }
  };

  // Handle generation with SSE streaming
  const handleGenerate = async () => {
    if (selectedModels.length === 0) {
      toast({
        title: "No models selected",
        description: "Please select at least one model to generate videos.",
        variant: "destructive"
      });
      return;
    }

    if (!promptDetails.trim()) {
      toast({
        title: "Missing prompt",
        description: "Please enter a video description.",
        variant: "destructive"
      });
      return;
    }

    // Clear any old sessionId and generate new one BEFORE generation starts
    localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
    const sessionId = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEYS.pendingSessionId, sessionId);
    console.log("[Video Gen] Generated new sessionId:", sessionId);

    // Validate required media based on generation type
    const minImages = currentGenTypeConfig?.minImages || 0;
    const maxImages = currentGenTypeConfig?.maxImages || 0;
    
    if ((currentGenTypeConfig?.requiresImage || currentGenTypeConfig?.requiresMultipleImages) && referenceImages.length < minImages) {
      const imageWord = minImages === 1 ? 'image' : 'images';
      const requirement = minImages === maxImages 
        ? `exactly ${minImages} ${imageWord}`
        : `at least ${minImages} ${imageWord}`;
      
      toast({
        title: "Images required",
        description: `This generation type requires ${requirement}.`,
        variant: "destructive"
      });
      return;
    }

    if (currentGenTypeConfig?.requiresVideo && !referenceVideo) {
      toast({
        title: "Video required",
        description: "This generation type requires a reference video.",
        variant: "destructive"
      });
      return;
    }

    // Reset state and clear cache for new generation
    setGeneratedVideos({});
    setErrors({});
    setIsGenerating(true);
    setGenerationProgress(0);
    clearVideoCache(); // Clear old cached videos
    
    // Create new AbortController for this generation
    abortControllerRef.current = new AbortController();

    // Build FormData
    const formData = new FormData();
    formData.append('selectedModels', JSON.stringify(selectedModels));
    formData.append('productId', selectedProductId);
    formData.append('promptDetails', promptDetails);
    formData.append('generationType', generationType);
    formData.append('duration', duration.toString());
    formData.append('amount', amount.toString());
    formData.append('aspectRatio', aspectRatio);
    formData.append('sessionId', sessionId); // Pass sessionId to backend

    // Add reference images - convert data URLs to Files if needed
    let filesToUpload = [...referenceImageFiles];
    
    console.log('[Video Gen] Reference images:', referenceImages.length);
    console.log('[Video Gen] Reference image files:', referenceImageFiles.length);
    
    // If we have reference images but no files (loaded from "Use for Video"), convert them now
    if (referenceImages.length > 0 && referenceImageFiles.length === 0) {
      console.log('[Video Gen] Converting', referenceImages.length, 'URLs to Files...');
      for (let i = 0; i < referenceImages.length; i++) {
        const url = referenceImages[i];
        console.log('[Video Gen] Processing URL', i, '- starts with:', url.substring(0, 50));
        
        try {
          let blob: Blob;
          
          if (url.startsWith('data:image/')) {
            // Handle data URLs (base64)
            const response = await fetch(url);
            blob = await response.blob();
          } else if (url.startsWith('/storage/') || url.startsWith('http')) {
            // Handle regular URLs - fetch the image first
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
            blob = await response.blob();
          } else {
            console.warn('[Video Gen] Unknown URL format, skipping:', url);
            continue;
          }
          
          const file = new File([blob], `reference-image-${i}.png`, { type: blob.type });
          filesToUpload.push(file);
          console.log('[Video Gen] Converted file', i, '- size:', blob.size, 'type:', blob.type);
        } catch (error) {
          console.error('[Video Gen] Failed to convert URL to File:', error);
        }
      }
      console.log('[Video Gen] Conversion complete. Total files to upload:', filesToUpload.length);
    }
    
    for (const file of filesToUpload) {
      formData.append('referenceImages', file);
      console.log('[Video Gen] Appending file to FormData:', file.name, file.size, file.type);
    }

    // Add reference video
    if (referenceVideoFile) {
      formData.append('referenceVideo', referenceVideoFile);
    }

    // Start smooth progress animation
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 0.5;
      if (progress < 90) {
        setGenerationProgress(Math.floor(progress));
      }
    }, 500);

    // Track video count locally to avoid stale state
    let videoCount = 0;

    try {
      const response = await fetch('/api/generate-videos-multi', {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to start video generation');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'status') {
                console.log('[Video Gen]', data.message);
              } else if (data.type === 'video') {
                // Track count locally
                videoCount++;
                
                // Upload video to storage and cache metadata
                (async () => {
                  try {
                    const filename = `video-${data.modelId}-${Date.now()}-${data.variationIndex}.mp4`;
                    const storagePath = await uploadToStorage(data.url, filename, 'video/mp4');
                    
                    // Cache metadata in localStorage
                    cacheVideo(data.modelId, {
                      storagePath,
                      modelName: data.modelName,
                      variationIndex: data.variationIndex,
                      prompt: promptDetails,
                      generationType: generationType,
                      duration: duration,
                      aspectRatio: aspectRatio,
                      productId: selectedProductId,
                      timestamp: Date.now(),
                    });
                    
                    // Add video to results with immutable generation metadata
                    setGeneratedVideos(prev => ({
                      ...prev,
                      [data.modelId]: [
                        ...(prev[data.modelId] || []),
                        {
                          url: data.url, // Use base64 for immediate display
                          modelName: data.modelName,
                          variationIndex: data.variationIndex,
                          // Store immutable metadata from this generation
                          prompt: promptDetails,
                          generationType: generationType,
                          duration: duration,
                          aspectRatio: aspectRatio,
                          referenceImageUrls: referenceImages,
                          productId: selectedProductId,
                          isLoaded: true, // Already loaded (new video)
                        }
                      ]
                    }));
                  } catch (uploadError) {
                    console.error('[Video Gen] Failed to upload to storage:', uploadError);
                    // Still show video even if upload failed
                    setGeneratedVideos(prev => ({
                      ...prev,
                      [data.modelId]: [
                        ...(prev[data.modelId] || []),
                        {
                          url: data.url,
                          modelName: data.modelName,
                          variationIndex: data.variationIndex,
                          prompt: promptDetails,
                          generationType: generationType,
                          duration: duration,
                          aspectRatio: aspectRatio,
                          referenceImageUrls: referenceImages,
                          productId: selectedProductId,
                          isLoaded: true,
                        }
                      ]
                    }));
                  }
                })();
              } else if (data.type === 'error') {
                setErrors(prev => ({
                  ...prev,
                  [data.modelId]: data.error
                }));
              } else if (data.type === 'rate_limit') {
                setErrors(prev => ({
                  ...prev,
                  [data.modelId]: data.error
                }));
                toast({
                  title: `${data.modelName} Rate Limited`,
                  description: data.error,
                  variant: "destructive"
                });
              } else if (data.type === 'done') {
                clearInterval(progressInterval);
                setGenerationProgress(100);
                setIsGenerating(false);
                
                toast({
                  title: "Generation Complete",
                  description: `Generated ${videoCount} video(s) with ${selectedModels.length} model(s)`,
                  action: (
                    <ToastAction altText="View Videos" onClick={() => setLocation('/video-generator')}>
                      View Videos
                    </ToastAction>
                  ),
                });
              }
            } catch (e) {
              console.error('[Video Gen] Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('[Video Gen] Error:', error);
      clearInterval(progressInterval);
      setIsGenerating(false);
      
      // Check if the error was due to cancellation
      if (error.name === 'AbortError') {
        toast({
          title: "Generation Cancelled",
          description: "Video generation was cancelled successfully",
        });
      } else {
        toast({
          title: "Generation Failed",
          description: error.message || "Failed to generate videos",
          variant: "destructive"
        });
      }
    } finally {
      // Clear pending session after completion or error
      localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
      abortControllerRef.current = null;
    }
  };
  
  // Handle cancel generation
  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
      setGenerationProgress(0);
      localStorage.removeItem(STORAGE_KEYS.pendingSessionId);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue="generator" className="flex-1 flex flex-col">
        <div className="border-b px-4 sm:px-6">
          <TabsList className="h-12 bg-transparent">
            <TabsTrigger 
              value="generator" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-video-generator"
            >
              Video Generator
            </TabsTrigger>
            <TabsTrigger 
              value="helper" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-video-prompt-helper"
            >
              Prompt Helper
            </TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="generator" className="flex-1 overflow-auto mt-0">
          <div className="container mx-auto p-6 space-y-6 max-w-7xl">
            <div>
              <h1 className="text-3xl font-bold">Video Generator</h1>
              <p className="text-muted-foreground mt-1">
                Generate marketing videos using multiple AI models
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Generation Type */}
              <div className="space-y-2">
                <Label>Generation Type</Label>
                <Select value={generationType} onValueChange={(v) => setGenerationType(v as GenerationType)}>
                  <SelectTrigger data-testid="select-generation-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(generationTypes).map(([key, config]) => (
                      <SelectItem key={key} value={key} data-testid={`option-gen-type-${key}`}>
                        {(config as GenerationTypeConfig).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentGenTypeConfig && (
                  <p className="text-xs text-muted-foreground">
                    {currentGenTypeConfig.description}
                  </p>
                )}
              </div>

              {/* Reference Media Uploads */}
              {(currentGenTypeConfig?.requiresImage || currentGenTypeConfig?.requiresMultipleImages) && (
                <div className="space-y-2">
                  <Label>
                    Reference Image{currentGenTypeConfig.requiresMultipleImages ? 's' : ''}
                    {currentGenTypeConfig.minImages === currentGenTypeConfig.maxImages 
                      ? ` (${currentGenTypeConfig.minImages} required)` 
                      : currentGenTypeConfig.maxImages 
                      ? ` (up to ${currentGenTypeConfig.maxImages})` 
                      : ''}
                  </Label>
                  
                  {referenceImages.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img src={img} alt={`Reference ${idx + 1}`} className="w-full rounded-lg border" />
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => removeReferenceImage(idx)}
                        data-testid={`button-remove-image-${idx}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  
                  {referenceImages.length < (currentGenTypeConfig.maxImages || 1) && (
                    <div className="flex gap-2">
                      <div
                        className="flex-1 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover-elevate"
                        onClick={() => document.getElementById('reference-images-input')?.click()}
                        data-testid="upload-reference-images"
                      >
                        <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">
                          Click to upload {referenceImages.length > 0 ? 'another' : 'an'} image
                        </p>
                        <input
                          id="reference-images-input"
                          type="file"
                          accept="image/*"
                          multiple={currentGenTypeConfig.requiresMultipleImages}
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                      </div>
                      <div
                        className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover-elevate flex flex-col items-center justify-center gap-2"
                        onClick={() => setMtpPickerOpen(true)}
                        data-testid="button-browse-mtp-video"
                      >
                        <FolderOpen className="h-6 w-6 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">MTP-Images</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {currentGenTypeConfig?.requiresVideo && (
                <div className="space-y-2">
                  <Label>Reference Video</Label>
                  
                  {referenceVideo ? (
                    <div className="relative">
                      <video src={referenceVideo} controls className="w-full rounded-lg border" />
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={removeReferenceVideo}
                        data-testid="button-remove-video"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover-elevate"
                      onClick={() => document.getElementById('reference-video-input')?.click()}
                      data-testid="upload-reference-video"
                    >
                      <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Click to upload a video
                      </p>
                      <input
                        id="reference-video-input"
                        type="file"
                        accept="video/*"
                        onChange={handleVideoUpload}
                        className="hidden"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Prompt */}
              <div className="space-y-2">
                <Label htmlFor="prompt-details">Video Description</Label>
                {suggestionsMutation.isPending && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Generating AI suggestions...
                  </p>
                )}
                <Textarea
                  id="prompt-details"
                  placeholder="Describe the video you want to create..."
                  value={promptDetails}
                  onChange={(e) => setPromptDetails(e.target.value)}
                  rows={4}
                  data-testid="textarea-prompt"
                />
              </div>

              {/* Duration */}
              <div className="space-y-2">
                <Label htmlFor="duration-select">
                  Video Length {durationConstraints.allowedDurations 
                    ? `(${durationConstraints.allowedDurations.join(' or ')}s only)`
                    : `(${durationConstraints.minDuration}-${durationConstraints.maxDuration}s)`}
                </Label>
                <Select 
                  value={duration.toString()} 
                  onValueChange={(v) => setDuration(parseInt(v))}
                >
                  <SelectTrigger id="duration-select" data-testid="select-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(durationConstraints.allowedDurations || Array.from(
                      { length: durationConstraints.maxDuration - durationConstraints.minDuration + 1 },
                      (_, i) => durationConstraints.minDuration + i
                    )).map(dur => (
                      <SelectItem key={dur} value={dur.toString()} data-testid={`option-duration-${dur}`}>
                        {dur} seconds
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Variations */}
              <div className="space-y-2">
                <Label htmlFor="amount-select">
                  Variations (max {maxVariationsAllowed})
                </Label>
                <Select 
                  value={amount.toString()} 
                  onValueChange={(v) => setAmount(parseInt(v))}
                >
                  <SelectTrigger id="amount-select" data-testid="select-variations">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: maxVariationsAllowed }, (_, i) => i + 1).map(num => (
                      <SelectItem key={num} value={num.toString()} data-testid={`option-variations-${num}`}>
                        {num} variation{num > 1 ? 's' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Aspect Ratio */}
              <div className="space-y-2">
                <Label htmlFor="aspect-select">Aspect Ratio</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger id="aspect-select" data-testid="select-aspect">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="16:9" data-testid="option-aspect-16-9">16:9 (Landscape)</SelectItem>
                    <SelectItem value="9:16" data-testid="option-aspect-9-16">9:16 (Portrait)</SelectItem>
                    <SelectItem value="1:1" data-testid="option-aspect-1-1">1:1 (Square)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Generate/Cancel Button */}
              {isGenerating ? (
                <Button
                  onClick={handleCancelGeneration}
                  variant="destructive"
                  className="w-full"
                  data-testid="button-cancel"
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel Generation
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={selectedModels.length === 0}
                  className="w-full"
                  data-testid="button-generate"
                >
                  {`Generate with ${selectedModels.length} Model${selectedModels.length > 1 ? 's' : ''}`}
                </Button>
              )}

              {isGenerating && (
                <div className="space-y-2" data-testid="container-generation-progress">
                  <Progress value={generationProgress} data-testid="progress-generation" />
                  <p className="text-xs text-center text-muted-foreground" data-testid="text-progress-percentage">
                    {generationProgress}%
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Model Selection Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Streaming Preview - Shows live AI generation */}
          {isStreaming && (
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                  <CardTitle className="text-base">AI Suggestions Generating...</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">
                  Suggestions appear as they're generated by Claude Sonnet 4
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Lifestyle Suggestions */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Lifestyle</Badge>
                      {streamingSuggestions.lifestyle.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {streamingSuggestions.lifestyle.length} of 3
                        </span>
                      )}
                    </div>
                    {streamingSuggestions.lifestyle.length > 0 ? (
                      <div className="space-y-2">
                        {streamingSuggestions.lifestyle.map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="w-full text-left p-3 rounded-md border bg-card hover-elevate active-elevate-2 text-sm animate-in fade-in slide-in-from-left-2 duration-300"
                            data-testid={`streaming-suggestion-lifestyle-${index}`}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Generating...
                      </div>
                    )}
                  </div>

                  {/* Product Suggestions */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Product</Badge>
                      {streamingSuggestions.product.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {streamingSuggestions.product.length} of 3
                        </span>
                      )}
                    </div>
                    {streamingSuggestions.product.length > 0 ? (
                      <div className="space-y-2">
                        {streamingSuggestions.product.map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="w-full text-left p-3 rounded-md border bg-card hover-elevate active-elevate-2 text-sm animate-in fade-in slide-in-from-left-2 duration-300"
                            data-testid={`streaming-suggestion-product-${index}`}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Generating...
                      </div>
                    )}
                  </div>

                  {/* UGC Suggestions */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">UGC Style</Badge>
                      {streamingSuggestions.ugc.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {streamingSuggestions.ugc.length} of 3
                        </span>
                      )}
                    </div>
                    {streamingSuggestions.ugc.length > 0 ? (
                      <div className="space-y-2">
                        {streamingSuggestions.ugc.map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="w-full text-left p-3 rounded-md border bg-card hover-elevate active-elevate-2 text-sm animate-in fade-in slide-in-from-left-2 duration-300"
                            data-testid={`streaming-suggestion-ugc-${index}`}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Generating...
                      </div>
                    )}
                  </div>

                  {/* Review Suggestions */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Review</Badge>
                      {streamingSuggestions.review.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {streamingSuggestions.review.length} of 3
                        </span>
                      )}
                    </div>
                    {streamingSuggestions.review.length > 0 ? (
                      <div className="space-y-2">
                        {streamingSuggestions.review.map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="w-full text-left p-3 rounded-md border bg-card hover-elevate active-elevate-2 text-sm animate-in fade-in slide-in-from-left-2 duration-300"
                            data-testid={`streaming-suggestion-review-${index}`}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Generating...
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Suggestions */}
          {suggestions && (
            <Card data-testid="card-suggestions">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">AI-Generated Video Suggestions</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click any suggestion to use it as your prompt
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Lifestyle Suggestions */}
                <Collapsible defaultOpen={false}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full hover-elevate p-2 rounded-md" data-testid="trigger-suggestions-lifestyle">
                    <div className="flex items-center gap-2">
                      <ChevronDown className="h-4 w-4" />
                      <span className="font-medium text-sm">Lifestyle</span>
                      <Badge variant="secondary">{suggestions.lifestyle.length}</Badge>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 mt-2">
                    {suggestions.lifestyle.map((suggestion, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="w-full text-left justify-start h-auto whitespace-normal p-3"
                        data-testid={`suggestion-lifestyle-${index}`}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </CollapsibleContent>
                </Collapsible>

                {/* Product Suggestions */}
                <Collapsible defaultOpen={false}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full hover-elevate p-2 rounded-md" data-testid="trigger-suggestions-product">
                    <div className="flex items-center gap-2">
                      <ChevronDown className="h-4 w-4" />
                      <span className="font-medium text-sm">Product</span>
                      <Badge variant="secondary">{suggestions.product.length}</Badge>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 mt-2">
                    {suggestions.product.map((suggestion, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="w-full text-left justify-start h-auto whitespace-normal p-3"
                        data-testid={`suggestion-product-${index}`}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </CollapsibleContent>
                </Collapsible>

                {/* UGC Suggestions */}
                <Collapsible defaultOpen={false}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full hover-elevate p-2 rounded-md" data-testid="trigger-suggestions-ugc">
                    <div className="flex items-center gap-2">
                      <ChevronDown className="h-4 w-4" />
                      <span className="font-medium text-sm">UGC Style</span>
                      <Badge variant="secondary">{suggestions.ugc.length}</Badge>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 mt-2">
                    {suggestions.ugc.map((suggestion, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="w-full text-left justify-start h-auto whitespace-normal p-3"
                        data-testid={`suggestion-ugc-${index}`}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </CollapsibleContent>
                </Collapsible>

                {/* Review Suggestions */}
                <Collapsible defaultOpen={false}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full hover-elevate p-2 rounded-md" data-testid="trigger-suggestions-review">
                    <div className="flex items-center gap-2">
                      <ChevronDown className="h-4 w-4" />
                      <span className="font-medium text-sm">Review</span>
                      <Badge variant="secondary">{suggestions.review.length}</Badge>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 mt-2">
                    {suggestions.review.map((suggestion, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="w-full text-left justify-start h-auto whitespace-normal p-3"
                        data-testid={`suggestion-review-${index}`}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Select Models</CardTitle>
              <p className="text-sm text-muted-foreground">
                Choose one or more models to generate videos
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {availableModels.length === 0 && (
                <Alert data-testid="alert-no-models">
                  <InfoIcon className="h-4 w-4" />
                  <AlertDescription>
                    No models available for this generation type.
                  </AlertDescription>
                </Alert>
              )}

              {availableModels.map((model) => {
                const isDisabled = !model.isAvailable || !model.isImplemented;
                return (
                <Card
                  key={model.id}
                  className={`${
                    isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover-elevate'
                  } ${selectedModels.includes(model.id) ? 'border-primary bg-accent' : ''}`}
                  onClick={() => !isDisabled && toggleModel(model.id)}
                  data-testid={`card-model-${model.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedModels.includes(model.id)}
                        disabled={isDisabled}
                        data-testid={`checkbox-model-${model.id}`}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold" data-testid={`text-model-name-${model.id}`}>{model.name}</h3>
                          <span className="text-xs text-muted-foreground" data-testid={`text-model-order-${model.id}`}>
                            #{model.order}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1" data-testid={`text-model-description-${model.id}`}>
                          {model.description}
                        </p>
                        {model.notes && (
                          <p className="text-xs text-muted-foreground mt-2 italic" data-testid={`text-model-notes-${model.id}`}>
                            {model.notes}
                          </p>
                        )}
                        {model.id === 'veo-2' && (
                          <Badge variant="destructive" className="mt-2" data-testid="badge-no-audio-veo-2">
                            No Audio
                          </Badge>
                        )}
                        {model.id === 'kling-2.6' && (
                          <Badge className="mt-2 bg-yellow-400 text-black hover:bg-yellow-500 font-semibold text-xs" data-testid="badge-warning-kling-2.6">
                            MOST LIKELY TO GENERATE VIDEOS THAT USUALLY VIOLATE CONTENT POLICIES
                          </Badge>
                        )}
                        {!model.isAvailable && model.unavailableMessage && (
                          <Alert className="mt-2" variant="destructive" data-testid={`alert-unavailable-${model.id}`}>
                            <AlertDescription className="text-xs">
                              {model.unavailableMessage}
                            </AlertDescription>
                          </Alert>
                        )}
                        {model.isAvailable && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2" data-testid={`text-available-${model.id}`}>
                            ✓ Available
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Results Section */}
      {(Object.keys(generatedVideos).length > 0 || Object.keys(errors).length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Generated Videos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedModels.map(modelId => {
              const model = availableModels.find(m => m.id === modelId);
              const videos = generatedVideos[modelId] || [];
              const error = errors[modelId];

              return (
                <div key={modelId} className="space-y-2" data-testid={`result-container-${modelId}`}>
                  <h3 className="font-semibold" data-testid={`text-result-model-${modelId}`}>
                    {model?.name || modelId}
                  </h3>
                  
                  {error && (
                    <Alert variant="destructive" data-testid={`alert-error-${modelId}`}>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  
                  {videos.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {videos.map((video, idx) => (
                        <Card key={idx} data-testid={`card-video-${modelId}-${idx}`}>
                          <CardContent className="p-4 space-y-3">
                            {video.isLoaded ? (
                              <video
                                src={video.url}
                                controls
                                className="w-full rounded-lg"
                                data-testid={`video-${modelId}-${idx}`}
                              />
                            ) : (
                              <div className="w-full aspect-video bg-muted rounded-lg flex flex-col items-center justify-center gap-2" data-testid={`placeholder-${modelId}-${idx}`}>
                                <p className="text-sm text-muted-foreground">Video cached from previous session</p>
                                <Button
                                  onClick={() => handleLoadVideo(modelId, idx)}
                                  variant="default"
                                  size="sm"
                                  data-testid={`button-load-${modelId}-${idx}`}
                                >
                                  <Download className="mr-2 h-4 w-4" />
                                  Load Video
                                </Button>
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground" data-testid={`text-variation-${modelId}-${idx}`}>
                              Variation {video.variationIndex + 1}
                            </p>
                            {video.isLoaded && (
                              <Button
                                onClick={() => handleSaveClick({ 
                                  url: video.url, 
                                  modelName: video.modelName,
                                  modelId: modelId,
                                  variationIndex: video.variationIndex,
                                  prompt: video.prompt,
                                  generationType: video.generationType,
                                  duration: video.duration,
                                  aspectRatio: video.aspectRatio,
                                  referenceImageUrls: video.referenceImageUrls,
                                  productId: video.productId
                                })}
                                variant="outline"
                                className="w-full"
                                data-testid={`button-save-${modelId}-${idx}`}
                              >
                                <Save className="mr-2 h-4 w-4" />
                                Save to Library
                              </Button>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  
                  {!error && videos.length === 0 && isGenerating && (
                    <p className="text-sm text-muted-foreground" data-testid={`text-generating-${modelId}`}>
                      Generating...
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Save to Library Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent data-testid="dialog-save-video">
          <DialogHeader>
            <DialogTitle>Save to Library</DialogTitle>
            <DialogDescription>
              Choose a product to associate with this video, or leave blank for no association.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Associate with Product (Optional)</Label>
              <Popover open={saveProductSearchOpen} onOpenChange={setSaveProductSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={saveProductSearchOpen}
                    className="w-full justify-between"
                    data-testid="button-save-product-select"
                  >
                    {saveProductId === "none" 
                      ? "No product association" 
                      : products.find((p) => p.id === saveProductId)?.name || "Select product..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0">
                  <Command>
                    <CommandInput placeholder="Search products..." data-testid="input-search-save-product" />
                    <CommandList>
                      <CommandEmpty>No product found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="none"
                          onSelect={() => {
                            setSaveProductId("none");
                            setSaveProductSearchOpen(false);
                          }}
                          data-testid="option-save-product-none"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              saveProductId === "none" ? "opacity-100" : "opacity-0"
                            )}
                          />
                          No product association
                        </CommandItem>
                        {products.map((product) => (
                          <CommandItem
                            key={product.id}
                            value={product.name}
                            onSelect={() => {
                              setSaveProductId(product.id);
                              setSaveProductSearchOpen(false);
                            }}
                            data-testid={`option-save-product-${product.id}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                saveProductId === product.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {product.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setSaveDialogOpen(false)}
              data-testid="button-cancel-save"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmSave}
              disabled={saveMutation.isPending}
              data-testid="button-confirm-save"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save to Library'
              )}
            </Button>
            <Button
              onClick={handleSaveAndDownload}
              disabled={saveMutation.isPending}
              data-testid="button-save-and-download"
            >
              <Download className="mr-2 h-4 w-4" />
              Save & Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
          </div>
        </TabsContent>
        
        <TabsContent value="helper" className="flex-1 overflow-auto mt-0">
          <VideoPromptHelper />
        </TabsContent>
      </Tabs>

      <MtpImagePicker
        open={mtpPickerOpen}
        onOpenChange={setMtpPickerOpen}
        onSelect={handleMtpImageSelect}
        title="Select Reference Image"
        description="Browse your MTP-Images library to select an image for video generation"
      />
    </div>
  );
}
