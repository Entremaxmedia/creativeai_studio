import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Loader2, AlertCircle, Upload, X, Image as ImageIcon, Save, FileText, Download, Check, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Product } from "@shared/schema";
import { getStorageUrl, getImageCache } from "@/lib/storageCache";
import { ImageWithInfo } from "./image-with-info";
import MtpImagePicker from "@/components/mtp-image-picker";
import { FolderOpen, CheckSquare, Square } from "lucide-react";
import StructuredFilenameDialog from "./structured-filename-dialog";
import { Checkbox } from "@/components/ui/checkbox";

interface GeneratedImage {
  url: string;
  provider: 'gpt' | 'gemini25' | 'imagen4' | 'nanobanana' | 'nanobanana2';
  revisedPrompt?: string;
  isLoaded?: boolean;
}

interface ImageSuggestions {
  lifestyle: string[];
  product: string[];
  ugc: string[];
  review: string[];
}

type StdGenListener = () => void;

interface StdGenJobState {
  isRunning: boolean;
  progress: number;
  status: string;
  gptImages: GeneratedImage[];
  gemini25Images: GeneratedImage[];
  imagen4Images: GeneratedImage[];
  nanoBananaImages: GeneratedImage[];
  nanoBanana2Images: GeneratedImage[];
  gptError: string | null;
  gemini25Error: string | null;
  imagen4Error: string | null;
  nanoBananaError: string | null;
  nanoBanana2Error: string | null;
}

const stdGenJob = {
  _state: null as StdGenJobState | null,
  _listeners: new Set<StdGenListener>(),
  _abortController: null as AbortController | null,
  _progressInterval: null as ReturnType<typeof setInterval> | null,

  get state(): StdGenJobState | null {
    return this._state;
  },

  subscribe(listener: StdGenListener) {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  },

  _notify() {
    this._listeners.forEach(l => l());
  },

  cancel() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    if (this._progressInterval) {
      clearInterval(this._progressInterval);
      this._progressInterval = null;
    }
    if (this._state) {
      this._state = { ...this._state, isRunning: false, progress: 0, status: "" };
      this._notify();
    }
  },

  async start(formData: FormData, promptDetails: string, selectedProductId: string): Promise<void> {
    if (this._state?.isRunning) return;

    this._state = {
      isRunning: true,
      progress: 0,
      status: "Preparing image generation...",
      gptImages: [],
      gemini25Images: [],
      imagen4Images: [],
      nanoBananaImages: [],
      nanoBanana2Images: [],
      gptError: null,
      gemini25Error: null,
      imagen4Error: null,
      nanoBananaError: null,
      nanoBanana2Error: null,
    };
    this._notify();

    this._abortController?.abort();
    this._abortController = new AbortController();

    let progress = 0;
    this._progressInterval = setInterval(() => {
      progress += Math.random() * 2;
      if (progress < 90 && this._state?.isRunning) {
        let status = "Analyzing product and prompt...";
        if (progress >= 30 && progress < 60) status = "Generating images with AI models...";
        else if (progress >= 60) status = "Finalizing images...";
        this._state = { ...this._state!, progress: Math.floor(progress), status };
        this._notify();
      }
    }, 200);

    try {
      const res = await fetch("/api/generate-images", {
        method: "POST",
        body: formData,
        signal: this._abortController.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to generate images" }));
        throw new Error(errorData.error || "Failed to generate images");
      }

      const data = await res.json();

      if (this._progressInterval) {
        clearInterval(this._progressInterval);
        this._progressInterval = null;
      }

      const uploadAndCache = async (images: GeneratedImage[], provider: 'gpt' | 'gemini25' | 'imagen4' | 'nanobanana' | 'nanobanana2') => {
        const { uploadToStorage, cacheImage, clearImageCache: _clear } = await import("@/lib/storageCache");
        const uploadedImages = await Promise.all(
          images.map(async (img) => {
            try {
              const filename = `image-${provider}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`;
              const storagePath = await uploadToStorage(img.url, filename, 'image/png');
              cacheImage(provider, {
                storagePath,
                provider,
                prompt: promptDetails,
                productId: selectedProductId,
                timestamp: Date.now(),
              });
              return { ...img, isLoaded: true };
            } catch (uploadError) {
              console.error(`[Image Gen] Failed to upload ${provider} image to storage:`, uploadError);
              return { ...img, isLoaded: true };
            }
          })
        );
        return uploadedImages;
      };

      const { clearImageCache } = await import("@/lib/storageCache");
      clearImageCache();

      const [gptUploaded, gemini25Uploaded, imagen4Uploaded, nanoBananaUploaded, nanoBanana2Uploaded] = await Promise.all([
        data.gptImages ? uploadAndCache(data.gptImages, 'gpt') : Promise.resolve([]),
        data.gemini25Images ? uploadAndCache(data.gemini25Images, 'gemini25') : Promise.resolve([]),
        data.imagen4Images ? uploadAndCache(data.imagen4Images, 'imagen4') : Promise.resolve([]),
        data.nanoBananaImages ? uploadAndCache(data.nanoBananaImages, 'nanobanana') : Promise.resolve([]),
        data.nanoBanana2Images ? uploadAndCache(data.nanoBanana2Images, 'nanobanana2') : Promise.resolve([]),
      ]);

      this._state = {
        isRunning: false,
        progress: 100,
        status: "Complete!",
        gptImages: gptUploaded,
        gemini25Images: gemini25Uploaded,
        imagen4Images: imagen4Uploaded,
        nanoBananaImages: nanoBananaUploaded,
        nanoBanana2Images: nanoBanana2Uploaded,
        gptError: data.errors?.gpt || null,
        gemini25Error: data.errors?.gemini25 || null,
        imagen4Error: data.errors?.imagen4 || null,
        nanoBananaError: data.errors?.nanobanana || null,
        nanoBanana2Error: data.errors?.nanobanana2 || null,
      };
      this._notify();

      this._abortController = null;
    } catch (err: any) {
      if (this._progressInterval) {
        clearInterval(this._progressInterval);
        this._progressInterval = null;
      }

      const errorMsg = err?.name === 'AbortError' ? null : (err?.message || "An unexpected error occurred");
      this._state = {
        ...this._state!,
        isRunning: false,
        progress: 0,
        status: "",
        gptError: errorMsg || this._state!.gptError,
        gemini25Error: errorMsg || this._state!.gemini25Error,
        imagen4Error: errorMsg || this._state!.imagen4Error,
        nanoBananaError: errorMsg || this._state!.nanoBananaError,
        nanoBanana2Error: errorMsg || this._state!.nanoBanana2Error,
      };
      this._notify();
      this._abortController = null;
      throw err;
    }
  },
};

export default function ImageGeneratorPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const [selectedProductId] = useState<string>("none");
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImageMtpKeys, setReferenceImageMtpKeys] = useState<string[]>([]);
  const [promptDetails, setPromptDetails] = useState("");
  const [amount, setAmount] = useState<1 | 2 | 4>(1);
  const [aspectRatio, setAspectRatio] = useState<'' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4'>('');
  const [suggestions, setSuggestions] = useState<ImageSuggestions | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingSuggestions, setStreamingSuggestions] = useState<ImageSuggestions>({
    lifestyle: [],
    product: [],
    ugc: [],
    review: []
  });
  
  const [gptImages, setGptImages] = useState<GeneratedImage[]>(() => stdGenJob.state?.gptImages || []);
  const [gemini25Images, setGemini25Images] = useState<GeneratedImage[]>(() => stdGenJob.state?.gemini25Images || []);
  const [imagen4Images, setImagen4Images] = useState<GeneratedImage[]>(() => stdGenJob.state?.imagen4Images || []);
  const [nanoBananaImages, setNanoBananaImages] = useState<GeneratedImage[]>(() => stdGenJob.state?.nanoBananaImages || []);
  const [nanoBanana2Images, setNanoBanana2Images] = useState<GeneratedImage[]>(() => stdGenJob.state?.nanoBanana2Images || []);
  const [gptError, setGptError] = useState<string | null>(() => stdGenJob.state?.gptError || null);
  const [gemini25Error, setGemini25Error] = useState<string | null>(() => stdGenJob.state?.gemini25Error || null);
  const [imagen4Error, setImagen4Error] = useState<string | null>(() => stdGenJob.state?.imagen4Error || null);
  const [nanoBananaError, setNanoBananaError] = useState<string | null>(() => stdGenJob.state?.nanoBananaError || null);
  const [nanoBanana2Error, setNanoBanana2Error] = useState<string | null>(() => stdGenJob.state?.nanoBanana2Error || null);
  const [gptSectionOpen, setGptSectionOpen] = useState(true);
  const [gemini25SectionOpen, setGemini25SectionOpen] = useState(true);
  const [imagen4SectionOpen, setImagen4SectionOpen] = useState(true);
  const [nanoBananaSectionOpen, setNanoBananaSectionOpen] = useState(true);
  const [nanoBanana2SectionOpen, setNanoBanana2SectionOpen] = useState(true);
  
  const [lifestyleSuggestionsOpen, setLifestyleSuggestionsOpen] = useState(false);
  const [productSuggestionsOpen, setProductSuggestionsOpen] = useState(false);
  const [ugcSuggestionsOpen, setUgcSuggestionsOpen] = useState(false);
  const [reviewSuggestionsOpen, setReviewSuggestionsOpen] = useState(false);
  
  const [gptAdjustments, setGptAdjustments] = useState<string[]>([]);
  const [gemini25Adjustments, setGemini25Adjustments] = useState<string[]>([]);
  const [imagen4Adjustments, setImagen4Adjustments] = useState<string[]>([]);
  const [nanoBananaAdjustments, setNanoBananaAdjustments] = useState<string[]>([]);
  const [nanoBanana2Adjustments, setNanoBanana2Adjustments] = useState<string[]>([]);
  const [adjustingImageIndex, setAdjustingImageIndex] = useState<{provider: 'gpt' | 'gemini25' | 'imagen4' | 'nanobanana' | 'nanobanana2', index: number} | null>(null);
  
  const [isGenerating, setIsGenerating] = useState(() => !!stdGenJob.state?.isRunning);
  const [generationProgress, setGenerationProgress] = useState(() => stdGenJob.state?.progress || 0);
  const [generationStatus, setGenerationStatus] = useState(() => stdGenJob.state?.status || "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // MTP Save state (replacing old library save)
  const [mtpSaveDialogOpen, setMtpSaveDialogOpen] = useState(false);
  const [imagesToSaveToMtp, setImagesToSaveToMtp] = useState<GeneratedImage[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [isMtpSaving, setIsMtpSaving] = useState(false);
  const [mtpSaveProgress, setMtpSaveProgress] = useState({ current: 0, total: 0 });
  
  // Use for Video state - when true, MTP save dialog also navigates to video generator after saving
  const [videoModeForMtp, setVideoModeForMtp] = useState(false);
  
  // MTP Image Picker state
  const [mtpPickerOpen, setMtpPickerOpen] = useState(false);

  // Fetch products from API
  const { data: productsData } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ["/api/products"],
  });

  const products = productsData?.products || [];

  useEffect(() => {
    const unsub = stdGenJob.subscribe(() => {
      const job = stdGenJob.state;
      if (!job) return;
      setIsGenerating(job.isRunning);
      setGenerationProgress(job.progress);
      setGenerationStatus(job.status);
      if (!job.isRunning) {
        setGptImages(job.gptImages);
        setGemini25Images(job.gemini25Images);
        setImagen4Images(job.imagen4Images);
        setNanoBananaImages(job.nanoBananaImages);
        setNanoBanana2Images(job.nanoBanana2Images);
        setGptError(job.gptError);
        setGemini25Error(job.gemini25Error);
        setImagen4Error(job.imagen4Error);
        setNanoBananaError(job.nanoBananaError);
        setNanoBanana2Error(job.nanoBanana2Error);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const loadPersistedState = async () => {
      if (stdGenJob.state?.isRunning || (stdGenJob.state && (stdGenJob.state.gptImages.length > 0 || stdGenJob.state.gemini25Images.length > 0 || stdGenJob.state.imagen4Images.length > 0 || stdGenJob.state.nanoBananaImages.length > 0 || stdGenJob.state.nanoBanana2Images.length > 0))) {
        return;
      }
      try {
        const saved = localStorage.getItem('imageGeneratorState');
        if (saved) {
          const state = JSON.parse(saved);
          
          const restoredReferenceImages = state.referenceImages || [];
          const restoredMtpKeys = state.referenceImageMtpKeys || [];
          setReferenceImages(restoredReferenceImages);
          setReferenceImageMtpKeys(restoredMtpKeys);
          
          if (restoredReferenceImages.length > 0) {
            const filePromises = restoredReferenceImages.map(async (dataUri: string, index: number) => {
              if (!dataUri || !dataUri.startsWith('data:')) return null;
              try {
                const response = await fetch(dataUri);
                const blob = await response.blob();
                return new File([blob], `reference-${index}.png`, { type: 'image/png' });
              } catch (error) {
                console.error(`Failed to restore reference image ${index}:`, error);
                return null;
              }
            });
            
            const files = await Promise.all(filePromises);
            setReferenceImageFiles(files as any[]);
          }
          
          setPromptDetails(state.promptDetails || "");
          setAmount(state.amount || 1);
          setAspectRatio(state.aspectRatio || '');
          setSuggestions(state.suggestions || null);
          setGptSectionOpen(state.gptSectionOpen ?? true);
          setGemini25SectionOpen(state.gemini25SectionOpen ?? true);
          setImagen4SectionOpen(state.imagen4SectionOpen ?? true);
          setNanoBananaSectionOpen(state.nanoBananaSectionOpen ?? true);
          setNanoBanana2SectionOpen(state.nanoBanana2SectionOpen ?? true);
          setGptAdjustments(state.gptAdjustments || []);
          setGemini25Adjustments(state.gemini25Adjustments || []);
          setImagen4Adjustments(state.imagen4Adjustments || []);
          setNanoBananaAdjustments(state.nanoBananaAdjustments || []);
          setNanoBanana2Adjustments(state.nanoBanana2Adjustments || []);
        }
      } catch (error) {
        console.error("Failed to load persisted image generator state:", error);
      }
    };
    
    loadPersistedState();
    
    const cache = getImageCache();
    if (!stdGenJob.state?.isRunning && !(stdGenJob.state && stdGenJob.state.gptImages.length > 0)) {
      if (cache.gpt) {
        setGptImages(cache.gpt.map(img => ({
          url: '',
          provider: 'gpt' as const,
          isLoaded: false,
        })));
      }
      if (cache.gemini25) {
        setGemini25Images(cache.gemini25.map(img => ({
          url: '',
          provider: 'gemini25' as const,
          isLoaded: false,
        })));
      }
      if (cache.imagen4) {
        setImagen4Images(cache.imagen4.map(img => ({
          url: '',
          provider: 'imagen4' as const,
          isLoaded: false,
        })));
      }
      if (cache.nanobanana) {
        setNanoBananaImages(cache.nanobanana.map(img => ({
          url: '',
          provider: 'nanobanana' as const,
          isLoaded: false,
        })));
      }
      if (cache.nanobanana2) {
        setNanoBanana2Images(cache.nanobanana2.map(img => ({
          url: '',
          provider: 'nanobanana2' as const,
          isLoaded: false,
        })));
      }
    }
  }, []);

  // Load image from storage
  const handleLoadImage = async (provider: 'gpt' | 'gemini25' | 'imagen4' | 'nanobanana' | 'nanobanana2', index: number) => {
    const cache = getImageCache();
    const cachedImage = cache[provider]?.[index];
    
    if (!cachedImage) {
      toast({
        title: "Image not found",
        description: "Could not find cached image data.",
        variant: "destructive"
      });
      return;
    }
    
    try {
      // Fetch from storage
      const storageUrl = getStorageUrl(cachedImage.storagePath);
      
      // Update the appropriate state
      const updateImages = (prevImages: GeneratedImage[]) =>
        prevImages.map((img, idx) =>
          idx === index ? { ...img, url: storageUrl, isLoaded: true } : img
        );
      
      if (provider === 'gpt') setGptImages(updateImages);
      else if (provider === 'gemini25') setGemini25Images(updateImages);
      else if (provider === 'imagen4') setImagen4Images(updateImages);
      else if (provider === 'nanobanana') setNanoBananaImages(updateImages);
      else if (provider === 'nanobanana2') setNanoBanana2Images(updateImages);
      
      toast({
        title: "Image Loaded",
        description: "Image loaded from storage successfully.",
      });
    } catch (error) {
      console.error('[Image Gen] Failed to load from storage:', error);
      toast({
        title: "Load Failed",
        description: "Failed to load image from storage.",
        variant: "destructive"
      });
    }
  };

  // Persist state to localStorage whenever it changes (excluding large base64 images to avoid QuotaExceeded)
  useEffect(() => {
    try {
      const state = {
        selectedProductId,
        referenceImages: referenceImages.map((img, i) => referenceImageMtpKeys[i] ? '' : img),
        referenceImageMtpKeys,
        promptDetails,
        amount,
        aspectRatio,
        suggestions,
        gptSectionOpen,
        gemini25SectionOpen,
        imagen4SectionOpen,
        nanoBananaSectionOpen,
        nanoBanana2SectionOpen,
        gptAdjustments,
        gemini25Adjustments,
        imagen4Adjustments,
        nanoBananaAdjustments,
        nanoBanana2Adjustments,
      };
      localStorage.setItem('imageGeneratorState', JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to persist image generator state:", error);
    }
  }, [selectedProductId, referenceImages, referenceImageMtpKeys, promptDetails, amount, aspectRatio, suggestions, gptSectionOpen, gemini25SectionOpen, imagen4SectionOpen, nanoBananaSectionOpen, nanoBanana2SectionOpen, gptAdjustments, gemini25Adjustments, imagen4Adjustments, nanoBananaAdjustments, nanoBanana2Adjustments]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    const readerPromises: Promise<string>[] = [];
    let invalidCount = 0;

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        validFiles.push(file);
        // Create a promise for each FileReader to maintain order
        const readerPromise = new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        readerPromises.push(readerPromise);
      } else {
        invalidCount++;
      }
    });

    if (readerPromises.length > 0) {
      const validPreviews = await Promise.all(readerPromises);
      setReferenceImageFiles(prev => [...prev, ...validFiles]);
      setReferenceImages(prev => [...prev, ...validPreviews]);
      setReferenceImageMtpKeys(prev => [...prev, ...validFiles.map(() => '')]);
    }

    if (invalidCount > 0) {
      toast({
        title: "Invalid File(s)",
        description: `${invalidCount} file(s) skipped. Please upload valid image files.`,
        variant: "destructive",
      });
    }
  };

  const handleImagePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    const readerPromises: Promise<string>[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          pastedFiles.push(blob);
          // Create a promise for each FileReader to maintain order
          const readerPromise = new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          readerPromises.push(readerPromise);
        }
      }
    }

    if (readerPromises.length > 0) {
      const pastedPreviews = await Promise.all(readerPromises);
      setReferenceImageFiles(prev => [...prev, ...pastedFiles]);
      setReferenceImages(prev => [...prev, ...pastedPreviews]);
      setReferenceImageMtpKeys(prev => [...prev, ...pastedFiles.map(() => '')]);
      
      toast({
        title: `Image${pastedFiles.length > 1 ? 's' : ''} Pasted`,
        description: `${pastedFiles.length} reference image(s) added successfully.`,
      });
    }
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
    setReferenceImageFiles(prev => prev.filter((_, i) => i !== index));
    setReferenceImageMtpKeys(prev => prev.filter((_, i) => i !== index));
    if (fileInputRef.current && referenceImages.length === 1) {
      fileInputRef.current.value = "";
    }
  };

  const handleMtpImageSelect = (image: { url: string; key: string }) => {
    setReferenceImages(prev => [...prev, '']);
    setReferenceImageFiles(prev => [...prev, null as any]);
    setReferenceImageMtpKeys(prev => [...prev, image.key]);
  };

  const handleCancelGeneration = () => {
    stdGenJob.cancel();
    toast({
      title: "Generation Cancelled",
      description: "Image generation was cancelled successfully",
    });
  };

  const adjustmentMutation = useMutation<
    { success: boolean; adjustedImage: GeneratedImage },
    Error,
    FormData
  >({
    mutationFn: async (data: FormData) => {
      const response = await fetch('/api/images/adjust', {
        method: 'POST',
        body: data,
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to adjust image';
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
        } catch {
          // If response isn't JSON, use the default error message
        }
        throw new Error(errorMessage);
      }
      
      return response.json();
    },
    onSuccess: (data, variables) => {
      const provider = variables.get('provider') as 'gpt' | 'gemini25' | 'imagen4' | 'nanobanana' | 'nanobanana2';
      const index = parseInt(variables.get('index') as string);
      
      console.log("Image adjustment response:", data);
      
      if (provider === 'gpt' && data.adjustedImage) {
        const newImages = [...gptImages];
        // Mark adjusted image as loaded so it displays immediately
        newImages[index] = { ...data.adjustedImage, isLoaded: true };
        setGptImages(newImages);
        
        // Clear the adjustment text after successful update
        const newAdjustments = [...gptAdjustments];
        newAdjustments[index] = '';
        setGptAdjustments(newAdjustments);
        
        toast({
          title: "Success",
          description: "GPT Image 1.5 image adjusted successfully",
        });
      } else if (provider === 'gemini25' && data.adjustedImage) {
        const newImages = [...gemini25Images];
        // Mark adjusted image as loaded so it displays immediately
        newImages[index] = { ...data.adjustedImage, isLoaded: true };
        setGemini25Images(newImages);
        
        // Clear the adjustment text after successful update
        const newAdjustments = [...gemini25Adjustments];
        newAdjustments[index] = '';
        setGemini25Adjustments(newAdjustments);
        
        toast({
          title: "Success",
          description: "Gemini 2.5 image adjusted successfully",
        });
      } else if (provider === 'imagen4' && data.adjustedImage) {
        const newImages = [...imagen4Images];
        // Mark adjusted image as loaded so it displays immediately
        newImages[index] = { ...data.adjustedImage, isLoaded: true };
        setImagen4Images(newImages);
        
        // Clear the adjustment text after successful update
        const newAdjustments = [...imagen4Adjustments];
        newAdjustments[index] = '';
        setImagen4Adjustments(newAdjustments);
        
        toast({
          title: "Success",
          description: "Imagen 4 Ultra image adjusted successfully",
        });
      } else if (provider === 'nanobanana' && data.adjustedImage) {
        const newImages = [...nanoBananaImages];
        newImages[index] = { ...data.adjustedImage, isLoaded: true };
        setNanoBananaImages(newImages);
        const newAdjustments = [...nanoBananaAdjustments];
        newAdjustments[index] = '';
        setNanoBananaAdjustments(newAdjustments);
        toast({
          title: "Success",
          description: "Nano Banana Pro image adjusted successfully",
        });
      } else if (provider === 'nanobanana2' && data.adjustedImage) {
        const newImages = [...nanoBanana2Images];
        newImages[index] = { ...data.adjustedImage, isLoaded: true };
        setNanoBanana2Images(newImages);
        const newAdjustments = [...nanoBanana2Adjustments];
        newAdjustments[index] = '';
        setNanoBanana2Adjustments(newAdjustments);
        toast({
          title: "Success",
          description: "Nano Banana 2 image adjusted successfully",
        });
      }
      
      setAdjustingImageIndex(null);
    },
    onError: (error) => {
      toast({
        title: "Adjustment Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
      setAdjustingImageIndex(null);
    },
  });

  const handleGenerate = async () => {
    if (!promptDetails.trim()) {
      toast({
        title: "Prompt Required",
        description: "Please provide prompt details for image generation.",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    formData.append('productId', selectedProductId);
    formData.append('promptDetails', promptDetails);
    formData.append('amount', amount.toString());
    formData.append('sessionId', crypto.randomUUID());
    if (aspectRatio) {
      formData.append('aspectRatio', aspectRatio);
    }
    referenceImageFiles.forEach((file) => {
      if (file) {
        formData.append('referenceImages', file);
      }
    });
    const mtpKeysForServer = referenceImageMtpKeys.filter(k => k);
    if (mtpKeysForServer.length > 0) {
      formData.append('referenceImageMtpKeys', JSON.stringify(mtpKeysForServer));
    }

    setGptImages([]);
    setGemini25Images([]);
    setImagen4Images([]);
    setNanoBananaImages([]);
    setGptAdjustments([]);
    setGemini25Adjustments([]);
    setImagen4Adjustments([]);
    setNanoBananaAdjustments([]);
    setGptError(null);
    setGemini25Error(null);
    setImagen4Error(null);
    setNanoBananaError(null);

    try {
      await stdGenJob.start(formData, promptDetails, selectedProductId);
      const job = stdGenJob.state;
      if (job) {
        const totalImages = job.gptImages.length + job.gemini25Images.length + job.imagen4Images.length + job.nanoBananaImages.length + job.nanoBanana2Images.length;
        const errorCount = [job.gptError, job.gemini25Error, job.imagen4Error, job.nanoBananaError, job.nanoBanana2Error].filter(Boolean).length;
        
        if (errorCount === 5) {
          toast({
            title: "Generation Failed",
            description: "All AI providers encountered errors. Check the error messages below.",
            variant: "destructive",
          });
        } else if (errorCount > 0) {
          const failedProviders = [];
          if (job.gptError) failedProviders.push("GPT Image 1.5");
          if (job.gemini25Error) failedProviders.push("Gemini 2.5");
          if (job.imagen4Error) failedProviders.push("Imagen 4 Ultra");
          if (job.nanoBananaError) failedProviders.push("Nano Banana Pro");
          if (job.nanoBanana2Error) failedProviders.push("Nano Banana 2");
          
          toast({
            title: "Partial Success",
            description: `${failedProviders.join(", ")} encountered error${failedProviders.length > 1 ? 's' : ''}, but other images were generated.`,
            variant: "default",
          });
        } else if (totalImages > 0) {
          toast({
            title: "Success",
            description: `Generated ${totalImages} marketing image${totalImages !== 1 ? 's' : ''}`,
            action: (
              <ToastAction altText="View Images" onClick={() => setLocation('/image-generator')}>
                View Images
              </ToastAction>
            ),
          });
        }
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return;
      }
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    }
  };

  const handleAdjust = async (provider: 'gpt' | 'gemini25' | 'imagen4' | 'nanobanana' | 'nanobanana2', index: number) => {
    const adjustmentText = provider === 'gpt' 
      ? gptAdjustments[index] 
      : provider === 'gemini25'
        ? gemini25Adjustments[index]
        : provider === 'imagen4'
          ? imagen4Adjustments[index]
          : provider === 'nanobanana'
            ? nanoBananaAdjustments[index]
            : nanoBanana2Adjustments[index];
    
    if (!adjustmentText?.trim()) {
      toast({
        title: "Adjustment Required",
        description: "Please describe what adjustments you want to make.",
        variant: "destructive",
      });
      return;
    }

    const image = provider === 'gpt' 
      ? gptImages[index] 
      : provider === 'gemini25'
        ? gemini25Images[index]
        : provider === 'imagen4'
          ? imagen4Images[index]
          : provider === 'nanobanana'
            ? nanoBananaImages[index]
            : nanoBanana2Images[index];
    
    // Convert data URL to blob
    const response = await fetch(image.url);
    const blob = await response.blob();
    
    const formData = new FormData();
    formData.append('provider', provider);
    formData.append('index', index.toString());
    formData.append('imageFile', blob, 'generated-image.png');
    formData.append('adjustmentPrompt', adjustmentText);
    formData.append('productId', selectedProductId);
    
    setAdjustingImageIndex({ provider, index });
    adjustmentMutation.mutate(formData);
  };

  // MTP Save handlers
  const handleSaveToMtpClick = (image: GeneratedImage) => {
    setImagesToSaveToMtp([image]);
    setMtpSaveDialogOpen(true);
  };

  const handleSaveSelectedToMtp = () => {
    const allImages = [
      ...gptImages.filter(img => img.isLoaded),
      ...gemini25Images.filter(img => img.isLoaded),
      ...imagen4Images.filter(img => img.isLoaded),
      ...nanoBananaImages.filter(img => img.isLoaded),
      ...nanoBanana2Images.filter(img => img.isLoaded),
    ];
    const selected = allImages.filter(img => selectedImages.has(img.url));
    if (selected.length === 0) {
      toast({
        title: "No images selected",
        description: "Please select at least one image to save",
        variant: "destructive",
      });
      return;
    }
    setImagesToSaveToMtp(selected);
    setMtpSaveDialogOpen(true);
  };

  const toggleImageSelection = (imageUrl: string) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageUrl)) {
        newSet.delete(imageUrl);
      } else {
        newSet.add(imageUrl);
      }
      return newSet;
    });
  };

  const handleMtpSave = async (filename: string, folderId?: number) => {
    if (imagesToSaveToMtp.length === 0) return;
    
    setIsMtpSaving(true);
    setMtpSaveProgress({ current: 0, total: imagesToSaveToMtp.length });
    
    try {
      let lastUploadUrl = '';
      for (let i = 0; i < imagesToSaveToMtp.length; i++) {
        const image = imagesToSaveToMtp[i];
        setMtpSaveProgress({ current: i + 1, total: imagesToSaveToMtp.length });
        
        let blob: Blob;
        const isDataUrl = image.url.startsWith('data:');
        const isLocalUrl = image.url.startsWith('/') || image.url.startsWith(window.location.origin);
        
        if (isDataUrl || isLocalUrl) {
          const res = await fetch(image.url);
          blob = await res.blob();
        } else {
          const proxyRes = await fetch('/api/images/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: image.url }),
          });
          if (!proxyRes.ok) throw new Error('Failed to fetch image for upload');
          const proxyData = await proxyRes.json();
          if (!proxyData.success) throw new Error(proxyData.error || 'Failed to fetch image');
          const dataRes = await fetch(proxyData.dataUrl);
          blob = await dataRes.blob();
        }
        
        const formData = new FormData();
        formData.append('filename', filename);
        formData.append('file', blob, `${filename}.png`);
        if (folderId) {
          formData.append('folderId', folderId.toString());
        }
        
        const uploadResponse = await fetch('/api/mtp-images/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (!uploadResponse.ok) {
          const error = await uploadResponse.json();
          throw new Error(error.error || 'Failed to upload image');
        }
        
        const mtpData = await uploadResponse.json();
        lastUploadUrl = mtpData.url || '';
      }
      
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-images'] });
      
      if (videoModeForMtp && imagesToSaveToMtp.length === 1 && lastUploadUrl) {
        const image = imagesToSaveToMtp[0];
        const saveRes = await apiRequest('POST', '/api/saved-images', {
          url: lastUploadUrl,
          provider: image.provider,
          prompt: promptDetails,
          revisedPrompt: image.revisedPrompt,
          status: 'saved',
        });
        const saveData = await saveRes.json() as { success: boolean; savedImage: { id: string; url: string } };
        
        queryClient.invalidateQueries({ queryKey: ['/api/saved-images'] });
        
        const videoState = {
          selectedProductId: "none",
          generationType: "image-to-video",
          promptDetails: "",
          duration: 6,
          amount: 1,
          aspectRatio: "16:9",
          selectedModels: ['sora-2'],
          suggestions: null,
          referenceImageIds: [saveData.savedImage.id],
        };
        localStorage.setItem('videoGeneratorState', JSON.stringify(videoState));
        
        toast({
          title: "Image saved to MTP Library",
          description: "Navigating to video generator...",
        });
        
        setMtpSaveDialogOpen(false);
        setImagesToSaveToMtp([]);
        setVideoModeForMtp(false);
        
        setLocation('/videos');
      } else {
        toast({
          title: "Success",
          description: `${imagesToSaveToMtp.length} image(s) saved to MTP Library`,
        });
        
        setMtpSaveDialogOpen(false);
        setImagesToSaveToMtp([]);
        setSelectedImages(new Set());
        setVideoModeForMtp(false);
      }
    } catch (error) {
      toast({
        title: "Failed to Save",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsMtpSaving(false);
      setMtpSaveProgress({ current: 0, total: 0 });
    }
  };

  // Use for Video handler - opens MTP save dialog, then navigates to video generator after saving
  const handleUseForVideo = (image: GeneratedImage) => {
    setImagesToSaveToMtp([image]);
    setVideoModeForMtp(true);
    setMtpSaveDialogOpen(true);
  };

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
        
        fetch('/api/generate-image-suggestions', {
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
                        
                        // Try to parse partial JSON to extract suggestions incrementally
                        const currentSuggestions: ImageSuggestions = {
                          lifestyle: [],
                          product: [],
                          ugc: [],
                          review: []
                        };
                        
                        try {
                          // Use [\s\S] to match across newlines (works without 's' flag)
                          const lifestyleMatch = jsonBuffer.match(/"lifestyle"\s*:\s*\[([\s\S]*?)\]/);
                          const productMatch = jsonBuffer.match(/"product"\s*:\s*\[([\s\S]*?)\]/);
                          const ugcMatch = jsonBuffer.match(/"ugc"\s*:\s*\[([\s\S]*?)\]/);
                          const reviewMatch = jsonBuffer.match(/"review"\s*:\s*\[([\s\S]*?)\]/);
                          
                          const extractStrings = (arrayContent: string): string[] => {
                            // Match quoted strings, handling escaped quotes
                            const stringPattern = /"((?:[^"\\]|\\.)*)"/g;
                            const matches: string[] = [];
                            let match;
                            while ((match = stringPattern.exec(arrayContent)) !== null) {
                              // Unescape the string
                              matches.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
                            }
                            return matches;
                          };
                          
                          if (lifestyleMatch) {
                            currentSuggestions.lifestyle = extractStrings(lifestyleMatch[1]);
                          }
                          if (productMatch) {
                            currentSuggestions.product = extractStrings(productMatch[1]);
                          }
                          if (ugcMatch) {
                            currentSuggestions.ugc = extractStrings(ugcMatch[1]);
                          }
                          if (reviewMatch) {
                            currentSuggestions.review = extractStrings(reviewMatch[1]);
                          }
                        } catch (e) {
                          // Ignore parsing errors during streaming
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
                      } else if (data.type === 'error') {
                        reject(new Error(data.error));
                      }
                    } catch (e) {
                      console.error('Error parsing SSE message:', e);
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
          description: "AI has analyzed your product and generated image ideas",
        });
      }
    },
    onError: (error) => {
      setIsStreaming(false);
      toast({
        title: "Failed to Generate Suggestions",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  const handleSuggestionClick = (suggestion: string) => {
    setPromptDetails(suggestion);
    toast({
      title: "Prompt Updated",
      description: "Suggestion has been added to your prompt",
    });
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-image-generator">Image Generator</h1>
        <p className="text-muted-foreground">
          Generate marketing images using OpenAI and Gemini
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
              {/* Reference Images Upload */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Reference Images (Optional)</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMtpPickerOpen(true)}
                    data-testid="button-browse-mtp"
                  >
                    <FolderOpen className="h-4 w-4 mr-2" />
                    Browse MTP-Images
                  </Button>
                </div>
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center space-y-2 hover-elevate active-elevate-2 cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  onPaste={handleImagePaste}
                  data-testid="area-image-upload"
                >
                  {(referenceImages.some(img => img) || referenceImageMtpKeys.some(k => k)) ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-4">
                        {referenceImages.map((img, index) => {
                          const mtpKey = referenceImageMtpKeys[index] || '';
                          const displaySrc = mtpKey ? `/api/mtp-images/proxy/${encodeURIComponent(mtpKey)}` : img;
                          if (!displaySrc) return null;
                          return (
                            <div key={index} className="relative group">
                              <img
                                src={displaySrc}
                                alt={`Reference ${index + 1}`}
                                className="max-w-full max-h-[400px] object-contain rounded-md"
                              />
                              <Button
                                size="icon"
                                variant="destructive"
                                className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeReferenceImage(index);
                                }}
                                data-testid={`button-remove-image-${index}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                              {mtpKey && (
                                <div className="absolute bottom-0 left-0 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-tr rounded-bl">
                                  MTP
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Click or paste to add more images
                      </p>
                    </div>
                  ) : (
                    <>
                      <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Click to upload or paste images
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Supports multiple images: JPG, PNG, GIF, WebP
                      </p>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageUpload}
                    data-testid="input-image-file"
                  />
                </div>
              </div>

              {/* Prompt Details */}
              <div className="space-y-2">
                <Label htmlFor="prompt-details">Prompt Details</Label>
                <Textarea
                  id="prompt-details"
                  placeholder="Describe the marketing image you want to generate... (e.g., 'Professional product photo on white background with dramatic lighting')"
                  value={promptDetails}
                  onChange={(e) => setPromptDetails(e.target.value)}
                  rows={6}
                  className="resize-none"
                  data-testid="input-prompt-details"
                />
              </div>

              {/* Amount Selection */}
              <div className="space-y-2">
                <Label htmlFor="amount-select">Amount of Images per AI</Label>
                <Select value={amount.toString()} onValueChange={(value) => setAmount(parseInt(value) as 1 | 2 | 4)}>
                  <SelectTrigger id="amount-select" data-testid="select-amount">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1" data-testid="option-amount-1">1 image per AI</SelectItem>
                    <SelectItem value="2" data-testid="option-amount-2">2 images per AI</SelectItem>
                    <SelectItem value="4" data-testid="option-amount-4">4 images per AI</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Total images: {amount * 3} (3 AI models × {amount})
                </p>
              </div>

              {/* Aspect Ratio Selection */}
              <div className="space-y-2">
                <Label>Aspect Ratio (Optional)</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Card
                    className={`cursor-pointer hover-elevate active-elevate-2 ${aspectRatio === '' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setAspectRatio('')}
                    data-testid="card-aspect-auto"
                  >
                    <CardContent className="p-4 text-center">
                      <div className="aspect-square bg-muted rounded mb-2 flex items-center justify-center">
                        <div className="w-8 h-8 bg-primary/20 rounded"></div>
                      </div>
                      <p className="text-xs font-medium">Auto</p>
                    </CardContent>
                  </Card>

                  <Card
                    className={`cursor-pointer hover-elevate active-elevate-2 ${aspectRatio === '1:1' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setAspectRatio('1:1')}
                    data-testid="card-aspect-1-1"
                  >
                    <CardContent className="p-4 text-center">
                      <div className="aspect-square bg-muted rounded mb-2 flex items-center justify-center">
                        <div className="w-8 h-8 bg-primary/20 rounded"></div>
                      </div>
                      <p className="text-xs font-medium">1:1</p>
                    </CardContent>
                  </Card>

                  <Card
                    className={`cursor-pointer hover-elevate active-elevate-2 ${aspectRatio === '16:9' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setAspectRatio('16:9')}
                    data-testid="card-aspect-16-9"
                  >
                    <CardContent className="p-4 text-center">
                      <div className="aspect-square bg-muted rounded mb-2 flex items-center justify-center">
                        <div className="w-full h-4 bg-primary/20 rounded"></div>
                      </div>
                      <p className="text-xs font-medium">16:9</p>
                    </CardContent>
                  </Card>

                  <Card
                    className={`cursor-pointer hover-elevate active-elevate-2 ${aspectRatio === '9:16' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setAspectRatio('9:16')}
                    data-testid="card-aspect-9-16"
                  >
                    <CardContent className="p-4 text-center">
                      <div className="aspect-square bg-muted rounded mb-2 flex items-center justify-center">
                        <div className="w-4 h-full bg-primary/20 rounded"></div>
                      </div>
                      <p className="text-xs font-medium">9:16</p>
                    </CardContent>
                  </Card>

                  <Card
                    className={`cursor-pointer hover-elevate active-elevate-2 ${aspectRatio === '4:3' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setAspectRatio('4:3')}
                    data-testid="card-aspect-4-3"
                  >
                    <CardContent className="p-4 text-center">
                      <div className="aspect-square bg-muted rounded mb-2 flex items-center justify-center">
                        <div className="w-10 h-8 bg-primary/20 rounded"></div>
                      </div>
                      <p className="text-xs font-medium">4:3</p>
                    </CardContent>
                  </Card>

                  <Card
                    className={`cursor-pointer hover-elevate active-elevate-2 ${aspectRatio === '3:4' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setAspectRatio('3:4')}
                    data-testid="card-aspect-3-4"
                  >
                    <CardContent className="p-4 text-center">
                      <div className="aspect-square bg-muted rounded mb-2 flex items-center justify-center">
                        <div className="w-6 h-8 bg-primary/20 rounded"></div>
                      </div>
                      <p className="text-xs font-medium">3:4</p>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* Generate/Cancel Button */}
              {isGenerating ? (
                <Button
                  onClick={handleCancelGeneration}
                  variant="destructive"
                  className="w-full"
                  data-testid="button-cancel-generation"
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel Generation
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={!promptDetails.trim()}
                  className="w-full"
                  data-testid="button-generate-images"
                >
                  Generate Images
                </Button>
              )}

              {/* Progress Bar */}
              {isGenerating && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{generationStatus}</span>
                    <span className="text-muted-foreground">{generationProgress}%</span>
                  </div>
                  <Progress value={generationProgress} className="w-full" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Batch Save Bar - show when images are selected */}
          {selectedImages.size > 0 && (
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-5 w-5 text-primary" />
                    <span className="font-medium">{selectedImages.size} image{selectedImages.size !== 1 ? 's' : ''} selected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedImages(new Set())}
                      data-testid="button-clear-selection"
                    >
                      Clear Selection
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveSelectedToMtp}
                      data-testid="button-save-selected-mtp"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Save Selected to MTP
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Suggestions */}
          {(suggestions || isStreaming) && (
            <Card data-testid="card-suggestions">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  AI-Generated Image Suggestions
                  {isStreaming && <Loader2 className="h-4 w-4 animate-spin" />}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Click any suggestion to use it as your prompt
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Lifestyle Images */}
                  <Collapsible open={lifestyleSuggestionsOpen} onOpenChange={setLifestyleSuggestionsOpen}>
                    <CollapsibleTrigger asChild>
                      <button 
                        className="w-full flex items-center justify-between p-2 rounded-md hover-elevate active-elevate-2"
                        data-testid="toggle-lifestyle-suggestions"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">Lifestyle</Badge>
                          <span className="text-xs text-muted-foreground">
                            {isStreaming 
                              ? `${streamingSuggestions.lifestyle.length} prompts (streaming...)` 
                              : `${suggestions?.lifestyle.length || 0} prompts`}
                          </span>
                        </div>
                        {lifestyleSuggestionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-2 mt-2">
                        {(isStreaming ? streamingSuggestions.lifestyle : suggestions?.lifestyle || []).map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="w-full text-left p-3 rounded-md border bg-card hover-elevate active-elevate-2 text-sm"
                            data-testid={`suggestion-lifestyle-${index}`}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Product Images */}
                  <Collapsible open={productSuggestionsOpen} onOpenChange={setProductSuggestionsOpen}>
                    <CollapsibleTrigger asChild>
                      <button 
                        className="w-full flex items-center justify-between p-2 rounded-md hover-elevate active-elevate-2"
                        data-testid="toggle-product-suggestions"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">Product</Badge>
                          <span className="text-xs text-muted-foreground">
                            {isStreaming 
                              ? `${streamingSuggestions.product.length} prompts (streaming...)` 
                              : `${suggestions?.product.length || 0} prompts`}
                          </span>
                        </div>
                        {productSuggestionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-2 mt-2">
                        {(isStreaming ? streamingSuggestions.product : suggestions?.product || []).map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="w-full text-left p-3 rounded-md border bg-card hover-elevate active-elevate-2 text-sm"
                            data-testid={`suggestion-product-${index}`}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* UGC Style Images */}
                  <Collapsible open={ugcSuggestionsOpen} onOpenChange={setUgcSuggestionsOpen}>
                    <CollapsibleTrigger asChild>
                      <button 
                        className="w-full flex items-center justify-between p-2 rounded-md hover-elevate active-elevate-2"
                        data-testid="toggle-ugc-suggestions"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">UGC Style</Badge>
                          <span className="text-xs text-muted-foreground">
                            {isStreaming 
                              ? `${streamingSuggestions.ugc.length} prompts (streaming...)` 
                              : `${suggestions?.ugc.length || 0} prompts`}
                          </span>
                        </div>
                        {ugcSuggestionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-2 mt-2">
                        {(isStreaming ? streamingSuggestions.ugc : suggestions?.ugc || []).map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="w-full text-left p-3 rounded-md border bg-card hover-elevate active-elevate-2 text-sm"
                            data-testid={`suggestion-ugc-${index}`}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Review Images */}
                  <Collapsible open={reviewSuggestionsOpen} onOpenChange={setReviewSuggestionsOpen}>
                    <CollapsibleTrigger asChild>
                      <button 
                        className="w-full flex items-center justify-between p-2 rounded-md hover-elevate active-elevate-2"
                        data-testid="toggle-review-suggestions"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">Review</Badge>
                          <span className="text-xs text-muted-foreground">
                            {isStreaming 
                              ? `${streamingSuggestions.review.length} prompts (streaming...)` 
                              : `${suggestions?.review.length || 0} prompts`}
                          </span>
                        </div>
                        {reviewSuggestionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-2 mt-2">
                        {(isStreaming ? streamingSuggestions.review : suggestions?.review || []).map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="w-full text-left p-3 rounded-md border bg-card hover-elevate active-elevate-2 text-sm"
                            data-testid={`suggestion-review-${index}`}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </CardContent>
            </Card>
          )}

          {/* OpenAI Results */}
          <Card>
            <Collapsible open={gptSectionOpen} onOpenChange={setGptSectionOpen}>
              <CardHeader className="cursor-pointer" onClick={() => setGptSectionOpen(!gptSectionOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle>OpenAI Images</CardTitle>
                      <Badge variant="secondary" data-testid="badge-gpt-count">
                        {gptImages.length} {gptImages.length === 1 ? 'image' : 'images'}
                      </Badge>
                    </div>
                    {gptSectionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {gptError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>OpenAI Error</AlertTitle>
                      <AlertDescription>{gptError}</AlertDescription>
                    </Alert>
                  )}
                  {gptImages.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {gptImages.map((image, index) => (
                        <div key={index} className="space-y-3" data-testid={`image-gpt-${index}`}>
                          {image.isLoaded ? (
                            <div className="relative">
                              <Button
                                size="icon"
                                variant={selectedImages.has(image.url) ? "default" : "outline"}
                                className="absolute top-2 left-2 z-10 h-8 w-8"
                                onClick={() => toggleImageSelection(image.url)}
                                data-testid={`button-select-gpt-${index}`}
                              >
                                {selectedImages.has(image.url) ? (
                                  <CheckSquare className="h-4 w-4" />
                                ) : (
                                  <Square className="h-4 w-4" />
                                )}
                              </Button>
                              <ImageWithInfo
                                src={image.url}
                                alt={`OpenAI generated ${index + 1}`}
                                className="w-full rounded-lg border"
                              />
                            </div>
                          ) : (
                            <div className="w-full aspect-square bg-muted rounded-lg flex flex-col items-center justify-center gap-2 border" data-testid={`placeholder-gpt-${index}`}>
                              <p className="text-sm text-muted-foreground">Image cached from previous session</p>
                              <Button
                                onClick={() => handleLoadImage('gpt', index)}
                                variant="default"
                                size="sm"
                                data-testid={`button-load-gpt-${index}`}
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Load Image
                              </Button>
                            </div>
                          )}
                          {image.revisedPrompt && (
                            <p className="text-sm text-muted-foreground">
                              <strong>Revised Prompt:</strong> {image.revisedPrompt}
                            </p>
                          )}
                          
                          {/* Save to MTP Button - only show for loaded images */}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleSaveToMtpClick(image)}
                              variant="outline"
                              className="w-full"
                              data-testid={`button-save-mtp-gpt-${index}`}
                            >
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Save to MTP
                            </Button>
                          )}
                          
                          {/* Use for Video Button - only show for loaded images */}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleUseForVideo(image)}
                              variant="default"
                              className="w-full"
                              data-testid={`button-video-gpt-${index}`}
                            >
                              <Video className="mr-2 h-4 w-4" />
                              Use for Video
                            </Button>
                          )}
                          
                          {/* Adjustment Input */}
                          <div className="space-y-2 border-t pt-3">
                            <Label htmlFor={`gpt-adjustment-${index}`} className="text-sm font-medium">
                              Adjust this image
                            </Label>
                            <div className="flex gap-2">
                              <Textarea
                                id={`gpt-adjustment-${index}`}
                                placeholder="Describe adjustments... (e.g., 'make the background darker', 'add more lighting on the product')"
                                value={gptAdjustments[index] || ''}
                                onChange={(e) => {
                                  const newAdjustments = [...gptAdjustments];
                                  newAdjustments[index] = e.target.value;
                                  setGptAdjustments(newAdjustments);
                                }}
                                rows={2}
                                className="resize-none flex-1"
                                data-testid={`input-gpt-adjustment-${index}`}
                              />
                              <Button
                                onClick={() => handleAdjust('gpt', index)}
                                disabled={
                                  adjustmentMutation.isPending && 
                                  adjustingImageIndex?.provider === 'gpt' && 
                                  adjustingImageIndex?.index === index
                                }
                                size="default"
                                data-testid={`button-adjust-gpt-${index}`}
                              >
                                {(adjustmentMutation.isPending && 
                                  adjustingImageIndex?.provider === 'gpt' && 
                                  adjustingImageIndex?.index === index) ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  </>
                                ) : (
                                  'Adjust'
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      No OpenAI images generated yet
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Nano Banana 2 Results */}
          <Card>
            <Collapsible open={nanoBanana2SectionOpen} onOpenChange={setNanoBanana2SectionOpen}>
              <CardHeader className="cursor-pointer" onClick={() => setNanoBanana2SectionOpen(!nanoBanana2SectionOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle>Nano Banana 2 Images</CardTitle>
                      <Badge variant="secondary" data-testid="badge-nanobanana2-count">
                        {nanoBanana2Images.length} {nanoBanana2Images.length === 1 ? 'image' : 'images'}
                      </Badge>
                    </div>
                    {nanoBanana2SectionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {nanoBanana2Error && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Nano Banana 2 Error</AlertTitle>
                      <AlertDescription>{nanoBanana2Error}</AlertDescription>
                    </Alert>
                  )}
                  {nanoBanana2Images.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {nanoBanana2Images.map((image, index) => (
                        <div key={index} className="space-y-3" data-testid={`image-nanobanana2-${index}`}>
                          {image.isLoaded ? (
                            <div className="relative">
                              <Button
                                size="icon"
                                variant={selectedImages.has(image.url) ? "default" : "outline"}
                                className="absolute top-2 left-2 z-10 h-8 w-8"
                                onClick={() => toggleImageSelection(image.url)}
                                data-testid={`button-select-nanobanana2-${index}`}
                              >
                                {selectedImages.has(image.url) ? (
                                  <CheckSquare className="h-4 w-4" />
                                ) : (
                                  <Square className="h-4 w-4" />
                                )}
                              </Button>
                              <ImageWithInfo
                                src={image.url}
                                alt={`Nano Banana 2 generated ${index + 1}`}
                                className="w-full rounded-lg border"
                              />
                            </div>
                          ) : (
                            <div className="w-full aspect-square bg-muted rounded-lg flex flex-col items-center justify-center gap-2 border" data-testid={`placeholder-nanobanana2-${index}`}>
                              <p className="text-sm text-muted-foreground">Image cached from previous session</p>
                              <Button
                                onClick={() => handleLoadImage('nanobanana2', index)}
                                variant="default"
                                size="sm"
                                data-testid={`button-load-nanobanana2-${index}`}
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Load Image
                              </Button>
                            </div>
                          )}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleSaveToMtpClick(image)}
                              variant="outline"
                              className="w-full"
                              data-testid={`button-save-mtp-nanobanana2-${index}`}
                            >
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Save to MTP
                            </Button>
                          )}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleUseForVideo(image)}
                              variant="default"
                              className="w-full"
                              data-testid={`button-video-nanobanana2-${index}`}
                            >
                              <Video className="mr-2 h-4 w-4" />
                              Use for Video
                            </Button>
                          )}
                          {image.isLoaded && (
                            <div className="space-y-2 border-t pt-3">
                              <Label htmlFor={`nanobanana2-adjustment-${index}`} className="text-sm font-medium">
                                Adjust this image
                              </Label>
                              <div className="flex gap-2">
                                <Textarea
                                  id={`nanobanana2-adjustment-${index}`}
                                  placeholder="Describe adjustments... (e.g., 'make the background darker', 'add more lighting on the product')"
                                  value={nanoBanana2Adjustments[index] || ''}
                                  onChange={(e) => {
                                    const newAdjustments = [...nanoBanana2Adjustments];
                                    newAdjustments[index] = e.target.value;
                                    setNanoBanana2Adjustments(newAdjustments);
                                  }}
                                  rows={2}
                                  className="resize-none flex-1"
                                  data-testid={`input-nanobanana2-adjustment-${index}`}
                                />
                                <Button
                                  onClick={() => handleAdjust('nanobanana2', index)}
                                  disabled={
                                    adjustmentMutation.isPending && 
                                    adjustingImageIndex?.provider === 'nanobanana2' && 
                                    adjustingImageIndex?.index === index
                                  }
                                  size="default"
                                  data-testid={`button-adjust-nanobanana2-${index}`}
                                >
                                  {(adjustmentMutation.isPending && 
                                    adjustingImageIndex?.provider === 'nanobanana2' && 
                                    adjustingImageIndex?.index === index) ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    'Adjust'
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      No Nano Banana 2 images generated yet
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Nano Banana Pro Results */}
          <Card>
            <Collapsible open={nanoBananaSectionOpen} onOpenChange={setNanoBananaSectionOpen}>
              <CardHeader className="cursor-pointer" onClick={() => setNanoBananaSectionOpen(!nanoBananaSectionOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle>Nano Banana Pro Images</CardTitle>
                      <Badge variant="secondary" data-testid="badge-nanobanana-count">
                        {nanoBananaImages.length} {nanoBananaImages.length === 1 ? 'image' : 'images'}
                      </Badge>
                    </div>
                    {nanoBananaSectionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {nanoBananaError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Nano Banana Pro Error</AlertTitle>
                      <AlertDescription>{nanoBananaError}</AlertDescription>
                    </Alert>
                  )}
                  {nanoBananaImages.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {nanoBananaImages.map((image, index) => (
                        <div key={index} className="space-y-3" data-testid={`image-nanobanana-${index}`}>
                          {image.isLoaded ? (
                            <div className="relative">
                              <Button
                                size="icon"
                                variant={selectedImages.has(image.url) ? "default" : "outline"}
                                className="absolute top-2 left-2 z-10 h-8 w-8"
                                onClick={() => toggleImageSelection(image.url)}
                                data-testid={`button-select-nanobanana-${index}`}
                              >
                                {selectedImages.has(image.url) ? (
                                  <CheckSquare className="h-4 w-4" />
                                ) : (
                                  <Square className="h-4 w-4" />
                                )}
                              </Button>
                              <ImageWithInfo
                                src={image.url}
                                alt={`Nano Banana Pro generated ${index + 1}`}
                                className="w-full rounded-lg border"
                              />
                            </div>
                          ) : (
                            <div className="w-full aspect-square bg-muted rounded-lg flex flex-col items-center justify-center gap-2 border" data-testid={`placeholder-nanobanana-${index}`}>
                              <p className="text-sm text-muted-foreground">Image cached from previous session</p>
                              <Button
                                onClick={() => handleLoadImage('nanobanana', index)}
                                variant="default"
                                size="sm"
                                data-testid={`button-load-nanobanana-${index}`}
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Load Image
                              </Button>
                            </div>
                          )}
                          
                          {/* Save to MTP Button - only show for loaded images */}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleSaveToMtpClick(image)}
                              variant="outline"
                              className="w-full"
                              data-testid={`button-save-mtp-nanobanana-${index}`}
                            >
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Save to MTP
                            </Button>
                          )}
                          
                          {/* Use for Video Button - only show for loaded images */}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleUseForVideo(image)}
                              variant="default"
                              className="w-full"
                              data-testid={`button-video-nanobanana-${index}`}
                            >
                              <Video className="mr-2 h-4 w-4" />
                              Use for Video
                            </Button>
                          )}
                          
                          {/* Adjustment Input - only show for loaded images */}
                          {image.isLoaded && (
                            <div className="space-y-2 border-t pt-3">
                              <Label htmlFor={`nanobanana-adjustment-${index}`} className="text-sm font-medium">
                                Adjust this image
                              </Label>
                              <div className="flex gap-2">
                                <Textarea
                                  id={`nanobanana-adjustment-${index}`}
                                  placeholder="Describe adjustments... (e.g., 'make the background darker', 'add more lighting on the product')"
                                  value={nanoBananaAdjustments[index] || ''}
                                  onChange={(e) => {
                                    const newAdjustments = [...nanoBananaAdjustments];
                                    newAdjustments[index] = e.target.value;
                                    setNanoBananaAdjustments(newAdjustments);
                                  }}
                                  rows={2}
                                  className="resize-none flex-1"
                                  data-testid={`input-nanobanana-adjustment-${index}`}
                                />
                                <Button
                                  onClick={() => handleAdjust('nanobanana', index)}
                                  disabled={
                                    adjustmentMutation.isPending && 
                                    adjustingImageIndex?.provider === 'nanobanana' && 
                                    adjustingImageIndex?.index === index
                                  }
                                  size="default"
                                  data-testid={`button-adjust-nanobanana-${index}`}
                                >
                                  {(adjustmentMutation.isPending && 
                                    adjustingImageIndex?.provider === 'nanobanana' && 
                                    adjustingImageIndex?.index === index) ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    </>
                                  ) : (
                                    'Adjust'
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      No Nano Banana Pro images generated yet
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Gemini 2.5 Flash Image Results */}
          <Card>
            <Collapsible open={gemini25SectionOpen} onOpenChange={setGemini25SectionOpen}>
              <CardHeader className="cursor-pointer" onClick={() => setGemini25SectionOpen(!gemini25SectionOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle>Gemini 2.5 Flash Images</CardTitle>
                      <Badge variant="secondary" data-testid="badge-gemini25-count">
                        {gemini25Images.length} {gemini25Images.length === 1 ? 'image' : 'images'}
                      </Badge>
                    </div>
                    {gemini25SectionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {gemini25Error && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Gemini 2.5 Error</AlertTitle>
                      <AlertDescription>{gemini25Error}</AlertDescription>
                    </Alert>
                  )}
                  {gemini25Images.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {gemini25Images.map((image, index) => (
                        <div key={index} className="space-y-3" data-testid={`image-gemini25-${index}`}>
                          {image.isLoaded ? (
                            <div className="relative">
                              <Button
                                size="icon"
                                variant={selectedImages.has(image.url) ? "default" : "outline"}
                                className="absolute top-2 left-2 z-10 h-8 w-8"
                                onClick={() => toggleImageSelection(image.url)}
                                data-testid={`button-select-gemini25-${index}`}
                              >
                                {selectedImages.has(image.url) ? (
                                  <CheckSquare className="h-4 w-4" />
                                ) : (
                                  <Square className="h-4 w-4" />
                                )}
                              </Button>
                              <ImageWithInfo
                                src={image.url}
                                alt={`Gemini 2.5 generated ${index + 1}`}
                                className="w-full rounded-lg border"
                              />
                            </div>
                          ) : (
                            <div className="w-full aspect-square bg-muted rounded-lg flex flex-col items-center justify-center gap-2 border" data-testid={`placeholder-gemini25-${index}`}>
                              <p className="text-sm text-muted-foreground">Image cached from previous session</p>
                              <Button
                                onClick={() => handleLoadImage('gemini25', index)}
                                variant="default"
                                size="sm"
                                data-testid={`button-load-gemini25-${index}`}
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Load Image
                              </Button>
                            </div>
                          )}
                          
                          {/* Save to MTP Button - only show for loaded images */}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleSaveToMtpClick(image)}
                              variant="outline"
                              className="w-full"
                              data-testid={`button-save-mtp-gemini25-${index}`}
                            >
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Save to MTP
                            </Button>
                          )}
                          
                          {/* Use for Video Button - only show for loaded images */}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleUseForVideo(image)}
                              variant="default"
                              className="w-full"
                              data-testid={`button-video-gemini25-${index}`}
                            >
                              <Video className="mr-2 h-4 w-4" />
                              Use for Video
                            </Button>
                          )}
                          
                          {/* Adjustment Input - only show for loaded images */}
                          {image.isLoaded && (
                            <div className="space-y-2 border-t pt-3">
                              <Label htmlFor={`gemini25-adjustment-${index}`} className="text-sm font-medium">
                                Adjust this image
                              </Label>
                              <div className="flex gap-2">
                                <Textarea
                                  id={`gemini25-adjustment-${index}`}
                                  placeholder="Describe adjustments... (e.g., 'make the background darker', 'add more lighting on the product')"
                                  value={gemini25Adjustments[index] || ''}
                                  onChange={(e) => {
                                    const newAdjustments = [...gemini25Adjustments];
                                    newAdjustments[index] = e.target.value;
                                    setGemini25Adjustments(newAdjustments);
                                  }}
                                  rows={2}
                                  className="resize-none flex-1"
                                  data-testid={`input-gemini25-adjustment-${index}`}
                                />
                                <Button
                                  onClick={() => handleAdjust('gemini25', index)}
                                  disabled={
                                    adjustmentMutation.isPending && 
                                    adjustingImageIndex?.provider === 'gemini25' && 
                                    adjustingImageIndex?.index === index
                                  }
                                  size="default"
                                  data-testid={`button-adjust-gemini25-${index}`}
                                >
                                  {(adjustmentMutation.isPending && 
                                    adjustingImageIndex?.provider === 'gemini25' && 
                                    adjustingImageIndex?.index === index) ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    </>
                                  ) : (
                                    'Adjust'
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      No Gemini 2.5 images generated yet
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Imagen 4 Ultra Results */}
          <Card>
            <Collapsible open={imagen4SectionOpen} onOpenChange={setImagen4SectionOpen}>
              <CardHeader className="cursor-pointer" onClick={() => setImagen4SectionOpen(!imagen4SectionOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle>Imagen 4 Ultra Images</CardTitle>
                      <Badge variant="secondary" data-testid="badge-imagen4-count">
                        {imagen4Images.length} {imagen4Images.length === 1 ? 'image' : 'images'}
                      </Badge>
                    </div>
                    {imagen4SectionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {imagen4Error && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Imagen 4 Ultra Error</AlertTitle>
                      <AlertDescription>{imagen4Error}</AlertDescription>
                    </Alert>
                  )}
                  {imagen4Images.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {imagen4Images.map((image, index) => (
                        <div key={index} className="space-y-3" data-testid={`image-imagen4-${index}`}>
                          {image.isLoaded ? (
                            <div className="relative">
                              <Button
                                size="icon"
                                variant={selectedImages.has(image.url) ? "default" : "outline"}
                                className="absolute top-2 left-2 z-10 h-8 w-8"
                                onClick={() => toggleImageSelection(image.url)}
                                data-testid={`button-select-imagen4-${index}`}
                              >
                                {selectedImages.has(image.url) ? (
                                  <CheckSquare className="h-4 w-4" />
                                ) : (
                                  <Square className="h-4 w-4" />
                                )}
                              </Button>
                              <ImageWithInfo
                                src={image.url}
                                alt={`Imagen 4 Ultra generated ${index + 1}`}
                                className="w-full rounded-lg border"
                              />
                            </div>
                          ) : (
                            <div className="w-full aspect-square bg-muted rounded-lg flex flex-col items-center justify-center gap-2 border" data-testid={`placeholder-imagen4-${index}`}>
                              <p className="text-sm text-muted-foreground">Image cached from previous session</p>
                              <Button
                                onClick={() => handleLoadImage('imagen4', index)}
                                variant="default"
                                size="sm"
                                data-testid={`button-load-imagen4-${index}`}
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Load Image
                              </Button>
                            </div>
                          )}
                          
                          {/* Save to MTP Button - only show for loaded images */}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleSaveToMtpClick(image)}
                              variant="outline"
                              className="w-full"
                              data-testid={`button-save-mtp-imagen4-${index}`}
                            >
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Save to MTP
                            </Button>
                          )}
                          
                          {/* Use for Video Button - only show for loaded images */}
                          {image.isLoaded && (
                            <Button
                              onClick={() => handleUseForVideo(image)}
                              variant="default"
                              className="w-full"
                              data-testid={`button-video-imagen4-${index}`}
                            >
                              <Video className="mr-2 h-4 w-4" />
                              Use for Video
                            </Button>
                          )}
                          
                          {/* Adjustment Input - only show for loaded images */}
                          {image.isLoaded && (
                            <div className="space-y-2 border-t pt-3">
                              <Label htmlFor={`imagen4-adjustment-${index}`} className="text-sm font-medium">
                                Adjust this image
                              </Label>
                              <div className="flex gap-2">
                                <Textarea
                                  id={`imagen4-adjustment-${index}`}
                                  placeholder="Describe adjustments... (e.g., 'make the background darker', 'add more lighting on the product')"
                                  value={imagen4Adjustments[index] || ''}
                                  onChange={(e) => {
                                    const newAdjustments = [...imagen4Adjustments];
                                    newAdjustments[index] = e.target.value;
                                    setImagen4Adjustments(newAdjustments);
                                  }}
                                  rows={2}
                                  className="resize-none flex-1"
                                  data-testid={`input-imagen4-adjustment-${index}`}
                                />
                                <Button
                                  onClick={() => handleAdjust('imagen4', index)}
                                  disabled={
                                    adjustmentMutation.isPending && 
                                    adjustingImageIndex?.provider === 'imagen4' && 
                                    adjustingImageIndex?.index === index
                                  }
                                  size="default"
                                  data-testid={`button-adjust-imagen4-${index}`}
                                >
                                  {(adjustmentMutation.isPending && 
                                    adjustingImageIndex?.provider === 'imagen4' && 
                                    adjustingImageIndex?.index === index) ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    </>
                                  ) : (
                                    'Adjust'
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      No Imagen 4 Ultra images generated yet
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>
      </div>


      <MtpImagePicker
        open={mtpPickerOpen}
        onOpenChange={setMtpPickerOpen}
        onSelect={handleMtpImageSelect}
        title="Select Reference Image"
        description="Browse your MTP-Images library to select a reference image"
      />

      {/* MTP Save Dialog with structured naming */}
      <StructuredFilenameDialog
        open={mtpSaveDialogOpen}
        onOpenChange={(open) => { setMtpSaveDialogOpen(open); if (!open) setVideoModeForMtp(false); }}
        onSave={handleMtpSave}
        isPending={isMtpSaving}
        title={videoModeForMtp ? "Save to MTP & Use for Video" : imagesToSaveToMtp.length > 1 ? `Save ${imagesToSaveToMtp.length} Images to MTP` : "Save to MTP-Images"}
        description={videoModeForMtp 
          ? "Save to MTP-Images, then navigate to video generator" 
          : imagesToSaveToMtp.length > 1 
            ? "Choose naming convention. Each image will be numbered automatically." 
            : "Choose naming convention and folder for this image"
        }
        progress={mtpSaveProgress.total > 0 ? mtpSaveProgress : undefined}
      />
    </div>
  );
}
