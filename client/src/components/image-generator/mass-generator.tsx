import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Loader2, Save, Video, Download, CheckSquare, Square, FolderOpen, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Product } from "@shared/schema";
import { uploadToStorage } from "@/lib/storageCache";
import { ImageWithInfo } from "./image-with-info";
import MtpImagePicker from "@/components/mtp-image-picker";
import StructuredFilenameDialog from "./structured-filename-dialog";

interface GeneratedImage {
  url: string;
  provider: 'gpt' | 'gemini25' | 'imagen4' | 'nanobanana' | 'nanobanana2';
  revisedPrompt?: string;
}

interface KieTaskId {
  taskId: string;
  provider: string;
}

interface PromptResult {
  prompt: string;
  promptNumber: number;
  images: GeneratedImage[];
  isOpen: boolean;
  isComplete: boolean;
  error?: string;
  kieTaskIds?: KieTaskId[];
  isRecovering?: boolean;
}

const getProviderDisplayName = (provider: string): string => {
  const names: Record<string, string> = {
    gpt: 'GPT Image 1.5',
    gemini25: 'Gemini 2.5',
    imagen4: 'Imagen 4',
    nanobanana: 'Nano Banana Pro',
    nanobanana2: 'Nano Banana 2',
  };
  return names[provider] || provider.toUpperCase();
};

const MASS_KEY_PROMPTS = "massGen_prompts";
const MASS_KEY_PRODUCT = "massGen_productId";
const MASS_KEY_AMOUNT = "massGen_amount";
const MASS_KEY_RATIO = "massGen_aspectRatio";
const MASS_KEY_REFS = "massGen_referenceImages";
const MASS_KEY_RESULTS = "massGen_results";
const MASS_KEY_SESSION_ID = "massGen_batchSessionId";

function isPermanentUrl(url: string): boolean {
  return url.startsWith('/storage/') || url.startsWith('data:');
}

async function uploadImageUrlToStorage(imageUrl: string): Promise<string> {
  let blob: Blob;
  if (imageUrl.startsWith('data:')) {
    const res = await fetch(imageUrl);
    blob = await res.blob();
  } else {
    const proxyRes = await fetch('/api/images/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl }),
    });
    if (!proxyRes.ok) throw new Error('Failed to fetch image via proxy');
    const proxyData = await proxyRes.json();
    if (!proxyData.success) throw new Error(proxyData.error || 'Proxy fetch failed');
    const dataRes = await fetch(proxyData.dataUrl);
    blob = await dataRes.blob();
  }
  const reader = new FileReader();
  const base64: string = await new Promise((resolve, reject) => {
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const filename = `mass-gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const storageUrl = await uploadToStorage(base64, filename, 'image/png');
  return storageUrl;
}

function loadSession<T>(key: string, fallback: T): T {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch {}
  return fallback;
}

type JobListener = () => void;

interface MassGenJobState {
  isRunning: boolean;
  results: PromptResult[];
  progress: number;
  currentPromptIndex: number;
  sessionId: string;
}

const massGenJob = {
  _state: null as MassGenJobState | null,
  _listeners: new Set<JobListener>(),

  get state(): MassGenJobState | null {
    return this._state;
  },

  subscribe(listener: JobListener) {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  },

  _notify() {
    if (this._state) {
      try {
        sessionStorage.setItem(MASS_KEY_RESULTS, JSON.stringify(this._state.results));
        sessionStorage.setItem(MASS_KEY_SESSION_ID, JSON.stringify(this._state.sessionId));
      } catch {}
    }
    this._listeners.forEach(l => l());
  },

  _updateResults(updater: (prev: PromptResult[]) => PromptResult[]) {
    if (!this._state) return;
    this._state = { ...this._state, results: updater(this._state.results) };
    this._notify();
  },

  clearStuckRecovery() {
    if (this._state && !this._state.isRunning) {
      const hadStuck = this._state.results.some(r => r.isRecovering);
      if (hadStuck) {
        this._state = {
          ...this._state,
          results: this._state.results.map(r => r.isRecovering ? { ...r, isRecovering: false, error: "Recovery cancelled" } : r),
        };
        this._notify();
      }
    }
    try {
      const saved = sessionStorage.getItem(MASS_KEY_RESULTS);
      if (saved) {
        const results = JSON.parse(saved) as PromptResult[];
        const hadStuck = results.some(r => r.isRecovering);
        if (hadStuck) {
          const cleaned = results.map(r => r.isRecovering ? { ...r, isRecovering: false, error: "Recovery cancelled" } : r);
          sessionStorage.setItem(MASS_KEY_RESULTS, JSON.stringify(cleaned));
        }
      }
    } catch {}
  },

  async start(params: {
    prompts: string[];
    selectedProductId: string;
    amount: 1 | 2 | 4;
    aspectRatio: string;
    referenceImages: string[];
    referenceImageUrls: string[];
  }) {
    if (this._state?.isRunning) return;

    const sessionId = crypto.randomUUID();
    const initialResults: PromptResult[] = params.prompts.map((prompt, index) => ({
      prompt,
      promptNumber: index + 1,
      images: [],
      isOpen: true,
      isComplete: false,
    }));

    this._state = {
      isRunning: true,
      results: initialResults,
      progress: 0,
      currentPromptIndex: 0,
      sessionId,
    };
    this._notify();

    console.log(`[Mass Gen] Starting batch with sessionId: ${sessionId}`);

    const snapshotRefs = [...params.referenceImages];
    const snapshotUrls = [...params.referenceImageUrls];
    const totalPrompts = params.prompts.length;
    let completedCount = 0;

    const generatePrompt = async (prompt: string, index: number) => {
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, index * 5000));
      }

      console.log(`[Mass Gen] Starting prompt ${index + 1}/${totalPrompts}`);

      try {
        const formData = new FormData();
        formData.append('promptDetails', prompt);
        formData.append('productId', params.selectedProductId === "none" ? "none" : params.selectedProductId);
        formData.append('amount', params.amount.toString());
        if (params.aspectRatio) {
          formData.append('aspectRatio', params.aspectRatio);
        }
        formData.append('sessionId', sessionId);

        if (snapshotUrls.length > 0) {
          formData.append('referenceImageUrls', JSON.stringify(snapshotUrls));
        }

        if (snapshotRefs.length > 0) {
          for (let i = 0; i < snapshotRefs.length; i++) {
            const dataUrl = snapshotRefs[i];
            if (!dataUrl || !dataUrl.startsWith('data:')) continue;
            const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
            const ext = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : mimeType === 'image/gif' ? '.gif' : '.png';
            const base64Data = dataUrl.split(',')[1] || dataUrl;
            const blob = await fetch(`data:${mimeType};base64,${base64Data}`).then(r => r.blob());
            formData.append('referenceImages', blob, `reference-${i}${ext}`);
          }
        }

        const response = await fetch("/api/generate-images", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          try {
            const error = await response.json();
            const err = new Error(error.details || "Failed to generate images") as any;
            err.kieTaskIds = error.kieTaskIds || [];
            throw err;
          } catch (parseErr: any) {
            if (parseErr.kieTaskIds) throw parseErr;
            throw new Error("Server error - response was not valid JSON (possible server restart)");
          }
        }

        const result = await response.json();

        this._updateResults(prev => prev.map((r, idx) =>
          idx === index ? {
            ...r,
            images: [
              ...(result.gptImages || []).map((img: any) => ({ ...img, provider: 'gpt' as const })),
              ...(result.nanoBananaImages || []).map((img: any) => ({ ...img, provider: 'nanobanana' as const })),
              ...(result.nanoBanana2Images || []).map((img: any) => ({ ...img, provider: 'nanobanana2' as const })),
              ...(result.gemini25Images || []).map((img: any) => ({ ...img, provider: 'gemini25' as const })),
              ...(result.imagen4Images || []).map((img: any) => ({ ...img, provider: 'imagen4' as const })),
            ],
            kieTaskIds: result.kieTaskIds || [],
            isComplete: true,
          } : r
        ));

        console.log(`[Mass Gen] Prompt ${index + 1} completed successfully`);
        return { success: true, index, kieTaskIds: result.kieTaskIds || [] };
      } catch (error: any) {
        const errorTaskIds = error.kieTaskIds || [];
        this._updateResults(prev => prev.map((r, idx) =>
          idx === index ? {
            ...r,
            isComplete: true,
            error: error.message || "Generation failed",
            kieTaskIds: errorTaskIds.length > 0 ? errorTaskIds : r.kieTaskIds,
          } : r
        ));

        console.log(`[Mass Gen] Prompt ${index + 1} failed: ${error.message}${errorTaskIds.length > 0 ? ` (${errorTaskIds.length} task IDs captured)` : ''}`);
        return { success: false, index, error: error.message };
      } finally {
        completedCount++;
        if (this._state) {
          this._state = {
            ...this._state,
            progress: (completedCount / totalPrompts) * 100,
            currentPromptIndex: completedCount - 1,
          };
          this._notify();
        }
      }
    };

    const allResults = await Promise.all(
      params.prompts.map((prompt, index) => generatePrompt(prompt, index))
    );

    if (this._state) {
      this._state = { ...this._state, isRunning: false };
      this._notify();
    }

    const successCount = allResults.filter(r => r.success).length;
    const failureCount = allResults.filter(r => !r.success).length;

    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === '/api/saved-images'
    });

    this._persistImages();

    return { successCount, failureCount, totalPrompts };
  },

  async _persistImages() {
    if (!this._state) return;
    const currentResults = this._state.results;
    const externalImages: { promptIdx: number; imgIdx: number; url: string }[] = [];
    currentResults.forEach((result, promptIdx) => {
      result.images.forEach((image, imgIdx) => {
        if (!isPermanentUrl(image.url)) {
          externalImages.push({ promptIdx, imgIdx, url: image.url });
        }
      });
    });

    if (externalImages.length === 0) return;
    console.log(`[Mass Gen] Background-saving ${externalImages.length} images to permanent storage...`);

    for (const { promptIdx, imgIdx, url } of externalImages) {
      try {
        const storageUrl = await uploadImageUrlToStorage(url);
        this._updateResults(prev => prev.map((r, rIdx) => {
          if (rIdx !== promptIdx) return r;
          const newImages = [...r.images];
          newImages[imgIdx] = { ...newImages[imgIdx], url: storageUrl };
          return { ...r, images: newImages };
        }));
      } catch (err) {
        console.warn(`[Mass Gen] Background save failed for ${promptIdx}-${imgIdx}:`, err);
      }
    }
    console.log(`[Mass Gen] Background save complete`);
  },
};

export default function MassImageGenerator() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [massPrompts, setMassPrompts] = useState(() => loadSession<string>(MASS_KEY_PROMPTS, ""));
  const [selectedProductId] = useState<string>("none");
  const [amount, setAmount] = useState<1 | 2 | 4>(() => loadSession<1 | 2 | 4>(MASS_KEY_AMOUNT, 1));
  const [aspectRatio, setAspectRatio] = useState<'' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4'>(() => loadSession(MASS_KEY_RATIO, ''));
  const [referenceImages, setReferenceImages] = useState<string[]>(() => loadSession<string[]>(MASS_KEY_REFS, []));
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>(() => loadSession<string[]>("massGen_referenceImageUrls", []));
  const [referenceImageMtpKeys, setReferenceImageMtpKeys] = useState<string[]>(() => loadSession<string[]>("massGen_referenceImageMtpKeys", []));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initFromJob = () => {
    const job = massGenJob.state;
    if (job) return { results: job.results, isGenerating: job.isRunning, progress: job.progress, currentPromptIndex: job.currentPromptIndex, batchSessionId: job.sessionId };
    const savedResults = loadSession<PromptResult[]>(MASS_KEY_RESULTS, []);
    return {
      results: savedResults.map(r => r.isRecovering ? { ...r, isRecovering: false, error: "Recovery cancelled" } : r),
      isGenerating: false,
      progress: 0,
      currentPromptIndex: 0,
      batchSessionId: loadSession<string>(MASS_KEY_SESSION_ID, ""),
    };
  };

  const [isGenerating, setIsGenerating] = useState(() => initFromJob().isGenerating);
  const [progress, setProgress] = useState(() => initFromJob().progress);
  const [currentPromptIndex, setCurrentPromptIndex] = useState(() => initFromJob().currentPromptIndex);
  const [results, setResults] = useState<PromptResult[]>(() => initFromJob().results);
  const [batchSessionId, setBatchSessionId] = useState<string>(() => initFromJob().batchSessionId);
  const [hasExpiredImages, setHasExpiredImages] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [reloadProgress, setReloadProgress] = useState({ current: 0, total: 0 });
  const expiredUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    massGenJob.clearStuckRecovery();
    const unsub = massGenJob.subscribe(() => {
      const job = massGenJob.state;
      if (!job) return;
      setResults(job.results);
      setIsGenerating(job.isRunning);
      setProgress(job.progress);
      setCurrentPromptIndex(job.currentPromptIndex);
      setBatchSessionId(job.sessionId);
    });
    return unsub;
  }, []);

  useEffect(() => {
    sessionStorage.setItem(MASS_KEY_PROMPTS, JSON.stringify(massPrompts));
  }, [massPrompts]);

  useEffect(() => {
    sessionStorage.setItem(MASS_KEY_AMOUNT, JSON.stringify(amount));
  }, [amount]);

  useEffect(() => {
    sessionStorage.setItem(MASS_KEY_RATIO, JSON.stringify(aspectRatio));
  }, [aspectRatio]);

  useEffect(() => {
    try {
      sessionStorage.setItem(MASS_KEY_REFS, JSON.stringify(referenceImages));
    } catch {}
  }, [referenceImages]);

  useEffect(() => {
    try {
      sessionStorage.setItem("massGen_referenceImageUrls", JSON.stringify(referenceImageUrls));
    } catch {}
  }, [referenceImageUrls]);

  useEffect(() => {
    try {
      sessionStorage.setItem("massGen_referenceImageMtpKeys", JSON.stringify(referenceImageMtpKeys));
    } catch {}
  }, [referenceImageMtpKeys]);

  useEffect(() => {
    if (!massGenJob.state?.isRunning) {
      try {
        sessionStorage.setItem(MASS_KEY_RESULTS, JSON.stringify(results));
      } catch {}
    }
  }, [results]);

  useEffect(() => {
    if (batchSessionId && !massGenJob.state?.isRunning) {
      sessionStorage.setItem(MASS_KEY_SESSION_ID, JSON.stringify(batchSessionId));
    }
  }, [batchSessionId]);

  const handleImageLoadError = (imageUrl: string) => {
    if (!isPermanentUrl(imageUrl)) {
      expiredUrlsRef.current.add(imageUrl);
      setHasExpiredImages(true);
    }
  };

  const handleReloadImages = async () => {
    const allExpiredImages: { promptIdx: number; imgIdx: number; image: GeneratedImage }[] = [];
    results.forEach((result, promptIdx) => {
      result.images.forEach((image, imgIdx) => {
        if (!isPermanentUrl(image.url)) {
          allExpiredImages.push({ promptIdx, imgIdx, image });
        }
      });
    });

    if (allExpiredImages.length === 0) {
      setHasExpiredImages(false);
      return;
    }

    setIsReloading(true);
    setReloadProgress({ current: 0, total: allExpiredImages.length });
    let successCount = 0;

    type SavedImageRecord = { id: string; url: string; provider: string; prompt: string };
    let savedLibraryImages: SavedImageRecord[] = [];
    if (batchSessionId) {
      try {
        const res = await fetch(`/api/saved-images/session/${batchSessionId}`);
        if (res.ok) {
          const data = await res.json();
          savedLibraryImages = data.savedImages || [];
          console.log(`[Mass Gen Reload] Found ${savedLibraryImages.length} saved images for session ${batchSessionId}`);
        }
      } catch (err) {
        console.warn("[Mass Gen Reload] Failed to fetch saved images by session:", err);
      }
    }

    for (let i = 0; i < allExpiredImages.length; i++) {
      const { promptIdx, imgIdx, image } = allExpiredImages[i];
      setReloadProgress({ current: i + 1, total: allExpiredImages.length });

      const prompt = results[promptIdx]?.prompt || "";
      const matchedSaved = savedLibraryImages.find(
        s => s.provider === image.provider && s.prompt === prompt && isPermanentUrl(s.url)
      );

      if (matchedSaved) {
        setResults(prev => prev.map((r, rIdx) => {
          if (rIdx !== promptIdx) return r;
          const newImages = [...r.images];
          newImages[imgIdx] = { ...newImages[imgIdx], url: matchedSaved.url };
          return { ...r, images: newImages };
        }));
        savedLibraryImages = savedLibraryImages.filter(s => s !== matchedSaved);
        successCount++;
        continue;
      }

      const matchedById = savedLibraryImages.find(
        s => s.provider === image.provider && s.prompt === prompt
      );
      if (matchedById) {
        const permanentUrl = `/api/saved-images/${matchedById.id}/image`;
        setResults(prev => prev.map((r, rIdx) => {
          if (rIdx !== promptIdx) return r;
          const newImages = [...r.images];
          newImages[imgIdx] = { ...newImages[imgIdx], url: permanentUrl };
          return { ...r, images: newImages };
        }));
        savedLibraryImages = savedLibraryImages.filter(s => s !== matchedById);
        successCount++;
        continue;
      }

      try {
        const storageUrl = await uploadImageUrlToStorage(image.url);
        setResults(prev => prev.map((r, rIdx) => {
          if (rIdx !== promptIdx) return r;
          const newImages = [...r.images];
          newImages[imgIdx] = { ...newImages[imgIdx], url: storageUrl };
          return { ...r, images: newImages };
        }));
        successCount++;
      } catch (err) {
        console.warn(`[Mass Gen Reload] Failed to reload image ${promptIdx}-${imgIdx}:`, err);
      }
    }

    expiredUrlsRef.current.clear();
    setIsReloading(false);
    setReloadProgress({ current: 0, total: 0 });

    if (successCount === allExpiredImages.length) {
      setHasExpiredImages(false);
      toast({
        title: "Images reloaded",
        description: `All ${successCount} images recovered successfully`,
      });
    } else if (successCount > 0) {
      toast({
        title: "Partial reload",
        description: `${successCount} of ${allExpiredImages.length} images recovered. Some may have expired beyond recovery.`,
      });
    } else {
      toast({
        title: "Reload failed",
        description: "The image URLs have expired and could not be recovered. The images are still available in your Image Library.",
        variant: "destructive",
      });
    }
  };

  
  // MTP Save state
  const [mtpSaveDialogOpen, setMtpSaveDialogOpen] = useState(false);
  const [imagesToSaveToMtp, setImagesToSaveToMtp] = useState<GeneratedImage[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [isMtpSaving, setIsMtpSaving] = useState(false);
  const [mtpSaveProgress, setMtpSaveProgress] = useState({ current: 0, total: 0 });
  
  // Adjustment state
  const [adjustmentTexts, setAdjustmentTexts] = useState<{ [key: string]: string }>({});
  const [adjustingImageKey, setAdjustingImageKey] = useState<string | null>(null);
  
  // Use for Video state - when true, MTP save dialog also navigates to video generator after saving
  const [videoModeForMtp, setVideoModeForMtp] = useState(false);
  const [videoImagePrompt, setVideoImagePrompt] = useState("");
  
  // Download dialog state
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadFilename, setDownloadFilename] = useState("");
  const [pendingDownload, setPendingDownload] = useState<{ url: string; promptNumber: number } | null>(null);
  
  // MTP Image Picker state
  const [mtpPickerOpen, setMtpPickerOpen] = useState(false);

  // Fetch products from API
  const { data: productsData } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ["/api/products"],
  });

  const products = productsData?.products || [];

  const handleReferenceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const fileArray = Array.from(files);
      setReferenceImageFiles(prev => [...prev, ...fileArray]);
      
      fileArray.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setReferenceImages(prev => [...prev, reader.result as string]);
          setReferenceImageUrls(prev => [...prev, '']);
          setReferenceImageMtpKeys(prev => [...prev, '']);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
    setReferenceImageFiles(prev => prev.filter((_, i) => i !== index));
    setReferenceImageUrls(prev => prev.filter((_, i) => i !== index));
    setReferenceImageMtpKeys(prev => prev.filter((_, i) => i !== index));
  };

  const handleMtpImageSelect = (image: { url: string; key: string }) => {
    setReferenceImages(prev => [...prev, '']);
    setReferenceImageFiles(prev => [...prev, null as any]);
    setReferenceImageUrls(prev => [...prev, image.url]);
    setReferenceImageMtpKeys(prev => [...prev, image.key]);
  };

  const generateMutation = useMutation({
    mutationFn: async ({ prompt, referenceImages: refs, referenceUrls, sessionId }: { prompt: string; referenceImages?: string[]; referenceUrls?: string[]; sessionId: string }) => {
      const formData = new FormData();
      formData.append('promptDetails', prompt);
      formData.append('productId', selectedProductId === "none" ? "none" : selectedProductId);
      formData.append('amount', amount.toString());
      if (aspectRatio) {
        formData.append('aspectRatio', aspectRatio);
      }
      formData.append('sessionId', sessionId);
      if (referenceUrls && referenceUrls.length > 0) {
        formData.append('referenceImageUrls', JSON.stringify(referenceUrls));
      }
      if (refs && refs.length > 0) {
        for (let i = 0; i < refs.length; i++) {
          const dataUrl = refs[i];
          if (!dataUrl || !dataUrl.startsWith('data:')) continue;
          const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
          const ext = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : mimeType === 'image/gif' ? '.gif' : '.png';
          const base64Data = dataUrl.split(',')[1] || dataUrl;
          const blob = await fetch(`data:${mimeType};base64,${base64Data}`).then(r => r.blob());
          formData.append('referenceImages', blob, `reference-${i}${ext}`);
        }
      }
      const response = await fetch("/api/generate-images", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        try {
          const error = await response.json();
          const err = new Error(error.details || "Failed to generate images") as any;
          err.kieTaskIds = error.kieTaskIds || [];
          throw err;
        } catch (parseErr: any) {
          if (parseErr.kieTaskIds) throw parseErr;
          throw new Error("Server error - response was not valid JSON (possible server restart)");
        }
      }
      return await response.json();
    },
  });

  const handleGenerate = async () => {
    const prompts = massPrompts
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .slice(0, 15);

    if (prompts.length === 0) {
      toast({
        title: "No prompts provided",
        description: "Please enter at least one prompt (separate prompts with a blank line, max 15)",
        variant: "destructive",
      });
      return;
    }

    setHasExpiredImages(false);
    expiredUrlsRef.current.clear();

    const result = await massGenJob.start({
      prompts,
      selectedProductId,
      amount,
      aspectRatio,
      referenceImages: [...referenceImages],
      referenceImageUrls: [...referenceImageUrls],
    });

    if (result) {
      const { successCount, failureCount, totalPrompts } = result;
      if (failureCount > 0) {
        toast({
          title: "Mass generation complete with errors",
          description: `${successCount} succeeded, ${failureCount} failed. Check individual cards for details.`,
          variant: failureCount === totalPrompts ? "destructive" : "default",
        });
      } else {
        toast({
          title: "Mass generation complete",
          description: `Successfully generated images for ${totalPrompts} prompt${totalPrompts > 1 ? 's' : ''}. Saving to permanent storage...`,
        });
      }
    }
  };

  const toggleResultCard = (index: number) => {
    setResults(prev => prev.map((r, idx) =>
      idx === index ? { ...r, isOpen: !r.isOpen } : r
    ));
  };

  const handleRefetch = async (index: number) => {
    const result = results[index];
    if (!result) return;

    setResults(prev => prev.map((r, idx) =>
      idx === index ? { ...r, isRecovering: true, isComplete: false, error: undefined } : r
    ));

    try {
      if (result.kieTaskIds && result.kieTaskIds.length > 0) {
        console.log(`[Mass Gen] Attempting to recover ${result.kieTaskIds.length} task(s) for prompt ${index + 1}`);
        const response = await apiRequest("POST", "/api/images/recover-tasks", {
          taskIds: result.kieTaskIds,
        });
        const data = await response.json();

        if (data.success && data.images && data.images.length > 0) {
          console.log(`[Mass Gen] Recovered ${data.images.length} image(s) for prompt ${index + 1}`);
          setResults(prev => prev.map((r, idx) =>
            idx === index ? {
              ...r,
              images: [...r.images, ...data.images.map((img: any) => ({ url: img.url, provider: img.provider }))],
              isComplete: true,
              isRecovering: false,
              error: undefined,
            } : r
          ));
          toast({
            title: "Images recovered",
            description: `Successfully recovered ${data.images.length} image(s) for Prompt ${result.promptNumber}`,
          });
          return;
        }
      }

      console.log(`[Mass Gen] No task IDs to recover for prompt ${index + 1}, re-generating...`);
      const regenResult = await generateMutation.mutateAsync({
        prompt: result.prompt,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        referenceUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
        sessionId: batchSessionId || crypto.randomUUID(),
      });

      setResults(prev => prev.map((r, idx) =>
        idx === index ? {
          ...r,
          images: [
            ...(regenResult.gptImages || []).map((img: any) => ({ ...img, provider: 'gpt' as const })),
            ...(regenResult.nanoBananaImages || []).map((img: any) => ({ ...img, provider: 'nanobanana' as const })),
            ...(regenResult.nanoBanana2Images || []).map((img: any) => ({ ...img, provider: 'nanobanana2' as const })),
            ...(regenResult.gemini25Images || []).map((img: any) => ({ ...img, provider: 'gemini25' as const })),
            ...(regenResult.imagen4Images || []).map((img: any) => ({ ...img, provider: 'imagen4' as const })),
          ],
          kieTaskIds: regenResult.kieTaskIds || [],
          isComplete: true,
          isRecovering: false,
          error: undefined,
        } : r
      ));
      toast({
        title: "Re-generation complete",
        description: `Successfully generated images for Prompt ${result.promptNumber}`,
      });
    } catch (error: any) {
      console.error(`[Mass Gen] Re-fetch failed for prompt ${index + 1}:`, error);
      setResults(prev => prev.map((r, idx) =>
        idx === index ? {
          ...r,
          isRecovering: false,
          error: error.message || "Re-fetch failed",
        } : r
      ));
      toast({
        title: "Re-fetch failed",
        description: error.message || "Failed to recover or regenerate images",
        variant: "destructive",
      });
    }
  };

  // MTP Save handlers
  const handleSaveToMtpClick = (image: GeneratedImage) => {
    setImagesToSaveToMtp([image]);
    setMtpSaveDialogOpen(true);
  };

  const handleSaveSelectedToMtp = () => {
    const allImages = results.flatMap(r => r.images);
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
          prompt: image.revisedPrompt || videoImagePrompt,
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
        setVideoImagePrompt("");
        
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
        setVideoImagePrompt("");
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

  // Adjustment mutation
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
      const imageKey = variables.get('imageKey') as string;
      const [promptIdx, imageIdx] = imageKey.split('-').map(Number);
      
      console.log("[Mass Adjust] Success:", { imageKey, promptIdx, imageIdx, data });
      
      if (data.adjustedImage) {
        // Update the image in the results
        setResults(prev => {
          const updated = prev.map((result, idx) => {
            if (idx === promptIdx) {
              const newImages = [...result.images];
              newImages[imageIdx] = data.adjustedImage;
              console.log("[Mass Adjust] Updated image at", promptIdx, imageIdx, "to", data.adjustedImage);
              return { ...result, images: newImages };
            }
            return result;
          });
          console.log("[Mass Adjust] New results:", updated);
          return updated;
        });
        
        // Clear the adjustment text
        setAdjustmentTexts(prev => {
          const newTexts = { ...prev };
          delete newTexts[imageKey];
          return newTexts;
        });
        
        toast({
          title: "Success",
          description: "Image adjusted successfully",
        });
      } else {
        console.error("[Mass Adjust] No adjusted image in response:", data);
      }
      
      setAdjustingImageKey(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to adjust image",
        description: error.message,
        variant: "destructive",
      });
      setAdjustingImageKey(null);
    },
  });

  // Handlers
  const handleAdjust = async (promptIdx: number, imageIdx: number, image: GeneratedImage) => {
    const imageKey = `${promptIdx}-${imageIdx}`;
    const adjustmentText = adjustmentTexts[imageKey];
    
    if (!adjustmentText?.trim()) {
      toast({
        title: "Adjustment Required",
        description: "Please describe what adjustments you want to make.",
        variant: "destructive",
      });
      return;
    }
    
    setAdjustingImageKey(imageKey);
    
    try {
      // Use server proxy to fetch external images (handles CORS)
      let imageDataUrl = image.url;
      if (!image.url.startsWith('data:')) {
        const proxyResponse = await apiRequest('POST', '/api/images/proxy', { url: image.url });
        const proxyData = await proxyResponse.json() as { success: boolean; dataUrl: string; error?: string };
        if (!proxyData.success) {
          throw new Error(proxyData.error || 'Failed to fetch image');
        }
        imageDataUrl = proxyData.dataUrl;
      }
      
      // Convert data URL to blob
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      
      const formData = new FormData();
      formData.append('provider', image.provider);
      formData.append('imageKey', imageKey);
      formData.append('imageFile', blob, 'generated-image.png');
      formData.append('adjustmentPrompt', adjustmentText);
      formData.append('productId', selectedProductId);
      
      adjustmentMutation.mutate(formData);
    } catch (error) {
      toast({
        title: "Failed to process image",
        description: error instanceof Error ? error.message : "Could not fetch the image for adjustment",
        variant: "destructive",
      });
      setAdjustingImageKey(null);
    }
  };

  const handleUseForVideo = (image: GeneratedImage, prompt: string) => {
    setImagesToSaveToMtp([image]);
    setVideoModeForMtp(true);
    setVideoImagePrompt(prompt);
    setMtpSaveDialogOpen(true);
  };

  const openDownloadDialog = (imageUrl: string, promptNumber: number) => {
    setPendingDownload({ url: imageUrl, promptNumber });
    setDownloadFilename("");
    setDownloadDialogOpen(true);
  };

  const handleDownload = async () => {
    if (!pendingDownload || !downloadFilename.trim()) return;
    
    try {
      // Use server proxy for external URLs to handle CORS
      let imageDataUrl = pendingDownload.url;
      if (!pendingDownload.url.startsWith('data:')) {
        const proxyResponse = await apiRequest('POST', '/api/images/proxy', { url: pendingDownload.url });
        const proxyData = await proxyResponse.json() as { success: boolean; dataUrl: string; error?: string };
        if (!proxyData.success) {
          throw new Error(proxyData.error || 'Failed to fetch image');
        }
        imageDataUrl = proxyData.dataUrl;
      }
      
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${downloadFilename.trim()}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setDownloadDialogOpen(false);
      setPendingDownload(null);
      setDownloadFilename("");
      
      toast({
        title: "Download started",
        description: "Image is being downloaded to your computer",
      });
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Failed to download image",
        variant: "destructive",
      });
    }
  };

  const promptCount = massPrompts.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Mass Image Generator</h1>
        <p className="text-muted-foreground">
          Generate images for up to 15 prompts simultaneously. Enter one prompt per line.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount-select">Images per AI Model</Label>
              <Select value={amount.toString()} onValueChange={(v) => setAmount(parseInt(v) as 1 | 2 | 4)}>
                <SelectTrigger id="amount-select" data-testid="select-amount">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 image</SelectItem>
                  <SelectItem value="2">2 images</SelectItem>
                  <SelectItem value="4">4 images</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="aspect-ratio-select">Aspect Ratio (Optional)</Label>
              <Select value={aspectRatio || "auto"} onValueChange={(v) => setAspectRatio(v === "auto" ? '' : v as any)}>
                <SelectTrigger id="aspect-ratio-select" data-testid="select-aspect-ratio">
                  <SelectValue placeholder="Model default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Model default</SelectItem>
                  <SelectItem value="1:1">1:1 (Square)</SelectItem>
                  <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                  <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                  <SelectItem value="4:3">4:3 (Standard)</SelectItem>
                  <SelectItem value="3:4">3:4 (Portrait)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reference-images">Reference Images (Optional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleReferenceImageChange}
              className="hidden"
              id="reference-images"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1"
                data-testid="button-upload-reference"
              >
                Upload Reference Images
              </Button>
              <Button
                variant="outline"
                onClick={() => setMtpPickerOpen(true)}
                data-testid="button-browse-mtp-mass"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                MTP-Images
              </Button>
            </div>
            {(referenceImages.some(img => img) || referenceImageMtpKeys.some(k => k)) && (
              <div className="flex flex-wrap gap-3 mt-2">
                {referenceImages.map((img, idx) => {
                  const mtpKey = referenceImageMtpKeys[idx] || '';
                  const displaySrc = mtpKey ? `/api/mtp-images/proxy/${encodeURIComponent(mtpKey)}` : img;
                  if (!displaySrc) return null;
                  return (
                    <div key={idx} className="relative group">
                      <img src={displaySrc} alt={`Reference ${idx + 1}`} className="max-w-full max-h-[350px] object-contain rounded" />
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeReferenceImage(idx)}
                      >
                        ×
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
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="mass-prompts">Image Prompts (separate with blank line, max 15)</Label>
              <Badge variant="secondary">{promptCount}/15 prompts</Badge>
            </div>
            <Textarea
              id="mass-prompts"
              placeholder="Professional photo of a modern laptop on a wooden desk with coffee cup, natural lighting, minimalist style, high quality product photography

Marketing image of organic coffee beans in burlap sack, rustic background, warm tones, overhead view

Vibrant abstract art painting with bold colors..."
              value={massPrompts}
              onChange={(e) => setMassPrompts(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
              data-testid="textarea-mass-prompts"
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || generateMutation.isPending || promptCount === 0 || promptCount > 15}
            className="w-full"
            data-testid="button-generate"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating {currentPromptIndex + 1}/{promptCount}...
              </>
            ) : (
              `Generate Images for ${promptCount} Prompt${promptCount !== 1 ? 's' : ''}`
            )}
          </Button>

          {isGenerating && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

        </CardContent>
      </Card>

      {/* Batch Save Bar */}
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

      {/* Reload Images Banner */}
      {hasExpiredImages && !isGenerating && results.length > 0 && (
        <Card className="border-orange-500/50 bg-orange-500/5">
          <CardContent className="py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="font-medium text-sm">Some images have expired</p>
                <p className="text-xs text-muted-foreground">
                  External image URLs have expired. Click reload to save them from the original source before they're gone.
                </p>
              </div>
              <Button
                onClick={handleReloadImages}
                disabled={isReloading}
                size="sm"
                data-testid="button-reload-images"
              >
                {isReloading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {reloadProgress.total > 0
                      ? `${reloadProgress.current}/${reloadProgress.total}`
                      : 'Reloading...'}
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reload All Images
                  </>
                )}
              </Button>
            </div>
            {isReloading && reloadProgress.total > 0 && (
              <Progress value={(reloadProgress.current / reloadProgress.total) * 100} className="mt-2" />
            )}
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Results</h2>
          {results.map((result, idx) => (
            <Card key={idx}>
              <Collapsible open={result.isOpen} onOpenChange={() => toggleResultCard(idx)}>
                <CardHeader className="cursor-pointer" onClick={() => toggleResultCard(idx)}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        <span>Prompt {result.promptNumber}</span>
                        {result.isComplete && !result.error && !result.isRecovering && (
                          <Badge variant="secondary">{result.images.length} images</Badge>
                        )}
                        {result.error && !result.isRecovering && (
                          <Badge variant="destructive">Failed</Badge>
                        )}
                        {result.isRecovering && (
                          <Badge variant="secondary">
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            Recovering...
                          </Badge>
                        )}
                        {!result.isComplete && !result.isRecovering && (
                          <Badge variant="secondary">
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            Generating...
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">{result.prompt}</p>
                    </div>
                    <ChevronDown className={`h-5 w-5 transition-transform ${result.isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent>
                    {result.isRecovering ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {result.kieTaskIds && result.kieTaskIds.length > 0 
                          ? "Attempting to recover images from previous generation..."
                          : "Re-generating images..."}
                      </div>
                    ) : result.error ? (
                      <div className="space-y-3">
                        <p className="text-destructive text-sm">{result.error}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); handleRefetch(idx); }}
                          data-testid={`button-refetch-prompt-${idx}`}
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                          {result.kieTaskIds && result.kieTaskIds.length > 0 ? "Recover Images" : "Re-generate"}
                        </Button>
                      </div>
                    ) : result.images.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {result.images.map((image, imgIdx) => {
                          const imageKey = `${idx}-${imgIdx}`;
                          const isAdjusting = adjustingImageKey === imageKey;
                          
                          return (
                            <div key={imgIdx} className="space-y-3 border rounded p-3">
                              <div className="relative">
                                <Button
                                  size="icon"
                                  variant={selectedImages.has(image.url) ? "default" : "outline"}
                                  className="absolute top-2 left-2 z-10 h-8 w-8"
                                  onClick={() => toggleImageSelection(image.url)}
                                  data-testid={`button-select-image-${idx}-${imgIdx}`}
                                >
                                  {selectedImages.has(image.url) ? (
                                    <CheckSquare className="h-4 w-4" />
                                  ) : (
                                    <Square className="h-4 w-4" />
                                  )}
                                </Button>
                                <ImageWithInfo 
                                  src={image.url} 
                                  alt={`Generated ${imgIdx + 1}`} 
                                  className="w-full rounded"
                                  onError={() => handleImageLoadError(image.url)}
                                />
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {getProviderDisplayName(image.provider)}
                              </Badge>
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleSaveToMtpClick(image)}
                                  data-testid={`button-save-mtp-${idx}-${imgIdx}`}
                                >
                                  <FolderOpen className="h-3 w-3 mr-1" />
                                  MTP
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openDownloadDialog(image.url, result.promptNumber)}
                                  data-testid={`button-download-${idx}-${imgIdx}`}
                                >
                                  <Download className="h-3 w-3 mr-1" />
                                  Download
                                </Button>
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleUseForVideo(image, result.prompt)}
                                  className="col-span-2"
                                  data-testid={`button-video-${idx}-${imgIdx}`}
                                >
                                  <Video className="h-3 w-3 mr-1" />
                                  Use for Video
                                </Button>
                              </div>
                              
                              {/* Adjustment Section */}
                              <div className="space-y-2 border-t pt-3">
                                <Label htmlFor={`adjust-${imageKey}`} className="text-sm font-medium">
                                  Adjust this image
                                </Label>
                                <div className="flex gap-2">
                                  <Textarea
                                    id={`adjust-${imageKey}`}
                                    placeholder="Describe adjustments... (e.g., 'make background darker', 'add more lighting')"
                                    value={adjustmentTexts[imageKey] || ''}
                                    onChange={(e) => {
                                      setAdjustmentTexts(prev => ({
                                        ...prev,
                                        [imageKey]: e.target.value
                                      }));
                                    }}
                                    rows={2}
                                    className="resize-none flex-1"
                                    data-testid={`input-adjust-${idx}-${imgIdx}`}
                                  />
                                  <Button
                                    onClick={() => handleAdjust(idx, imgIdx, image)}
                                    disabled={isAdjusting}
                                    size="default"
                                    data-testid={`button-adjust-${idx}-${imgIdx}`}
                                  >
                                    {isAdjusting ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      'Adjust'
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">No images generated yet</p>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}


      {/* Download Dialog */}
      <Dialog open={downloadDialogOpen} onOpenChange={setDownloadDialogOpen}>
        <DialogContent data-testid="dialog-download">
          <DialogHeader>
            <DialogTitle>Download Image</DialogTitle>
            <DialogDescription>
              Enter a name for your file. The extension (.png) will be added automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="download-filename">File Name</Label>
            <Input
              id="download-filename"
              value={downloadFilename}
              onChange={(e) => setDownloadFilename(e.target.value)}
              placeholder="my-image"
              data-testid="input-download-filename"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && downloadFilename.trim()) {
                  handleDownload();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDownloadDialogOpen(false)}
              data-testid="button-download-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDownload}
              disabled={!downloadFilename.trim()}
              data-testid="button-download-confirm"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        onOpenChange={(open) => { setMtpSaveDialogOpen(open); if (!open) { setVideoModeForMtp(false); setVideoImagePrompt(""); } }}
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
