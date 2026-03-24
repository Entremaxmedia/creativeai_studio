import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Loader2, AlertCircle, Upload, X, Video as VideoIcon, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Product } from "@shared/schema";
import VideoPromptHelper from "@/components/video-generator/video-prompt-helper";

interface GeneratedVideo {
  url: string;
  provider: 'sora' | 'veo';
}

export default function VideoGenerator() {
  const { toast } = useToast();

  // Configuration state
  const [selectedProductId, setSelectedProductId] = useState<string>("none");
  const [generationType, setGenerationType] = useState<'text-to-video' | 'image-to-video'>('text-to-video');
  const [promptDetails, setPromptDetails] = useState<string>("");
  const [duration, setDuration] = useState<number>(8);
  const [amount, setAmount] = useState<number>(1);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  
  // Reference image state (multiple images for image-to-video)
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  
  // Generation results state
  const [soraVideos, setSoraVideos] = useState<GeneratedVideo[]>([]);
  const [veoVideos, setVeoVideos] = useState<GeneratedVideo[]>([]);
  const [soraError, setSoraError] = useState<string | null>(null);
  const [veoError, setVeoError] = useState<string | null>(null);
  
  // Model tracking state
  const [currentVeoModel, setCurrentVeoModel] = useState<string>("Veo 3.1 Fast");
  
  // UI state
  const [soraSectionOpen, setSoraSectionOpen] = useState(true);
  const [veoSectionOpen, setVeoSectionOpen] = useState(true);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState("");
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Save dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [videoToSave, setVideoToSave] = useState<GeneratedVideo | null>(null);
  const [saveProductId, setSaveProductId] = useState<string>("none");

  // Fetch products
  const { data: productsData } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ["/api/products"],
  });

  const products = productsData?.products || [];

  // Load persisted state from localStorage on mount
  useEffect(() => {
    const loadPersistedState = () => {
      try {
        const saved = localStorage.getItem('videoGeneratorState');
        if (saved) {
          const state = JSON.parse(saved);
          setSelectedProductId(state.selectedProductId || "none");
          setGenerationType(state.generationType || 'text-to-video');
          setPromptDetails(state.promptDetails || "");
          setDuration(state.duration || 8);
          setAmount(state.amount || 1);
          setAspectRatio(state.aspectRatio || '16:9');
          setSoraError(state.soraError || null);
          setVeoError(state.veoError || null);
          setSoraSectionOpen(state.soraSectionOpen ?? true);
          setVeoSectionOpen(state.veoSectionOpen ?? true);
        }
      } catch (error) {
        console.error("Failed to load persisted video generator state:", error);
      }
    };
    
    loadPersistedState();
  }, []);

  // Persist state to localStorage whenever it changes (excluding large video data)
  useEffect(() => {
    try {
      const state = {
        selectedProductId,
        generationType,
        promptDetails,
        duration,
        amount,
        aspectRatio,
        soraVideoCount: soraVideos.length,
        veoVideoCount: veoVideos.length,
        soraError,
        veoError,
        soraSectionOpen,
        veoSectionOpen,
      };
      localStorage.setItem('videoGeneratorState', JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to persist video generator state:", error);
    }
  }, [selectedProductId, generationType, promptDetails, duration, amount, aspectRatio, soraVideos.length, veoVideos.length, soraError, veoError, soraSectionOpen, veoSectionOpen]);

  // Cleanup progress interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  // Streaming video generation with SSE
  const [isGenerating, setIsGenerating] = useState(false);
  
  const generateVideosWithStreaming = async (formData: FormData) => {
    setIsGenerating(true);
    setSoraVideos([]);
    setVeoVideos([]);
    setSoraError(null);
    setVeoError(null);
    setGenerationProgress(0);
    setGenerationStatus("Starting video generation...");
    
    // Start smooth progress animation
    let progress = 0;
    progressIntervalRef.current = setInterval(() => {
      progress += Math.random() * 0.8;
      if (progress < 90) {
        setGenerationProgress(Math.floor(progress));
      }
    }, 500);
    
    // Track results locally for final toast
    let localSoraVideos = 0;
    let localVeoVideos = 0;
    let localSoraError: string | null = null;
    let localVeoError: string | null = null;
    
    try {
      console.log('[Video Gen] Starting SSE request...');
      const response = await fetch('/api/generate-videos-stream', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to start video generation');
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('No response body');
      }
      
      let completedProviders = 0;
      const totalProviders = 2; // Sora and Veo
      console.log('[Video Gen] SSE stream connected, reading events...');
      
      // Buffer for accumulating partial SSE frames across chunks
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('[Video Gen] SSE stream ended');
          break;
        }
        
        // Append new chunk to buffer
        buffer += decoder.decode(value, { stream: true });
        
        // Normalize line endings to handle both \n\n and \r\n\r\n
        const normalizedBuffer = buffer.replace(/\r\n/g, '\n');
        
        // Process complete SSE frames (ended with \n\n)
        const frames = normalizedBuffer.split('\n\n');
        
        // Keep last incomplete frame in original buffer for next iteration
        buffer = frames.pop() || '';
        
        // Process complete frames
        for (const frame of frames) {
          if (!frame.trim()) continue;
          
          const lines = frame.split('\n');
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
              try {
                const jsonStr = trimmedLine.slice(6).trim();
                const data = JSON.parse(jsonStr);
                console.log('[Video Gen] SSE event:', data);
                
                if (data.type === 'status') {
                  setGenerationStatus(data.message || `${data.provider || ''} generating...`);
                  // Update Veo model name if provided
                  if (data.provider === 'veo' && data.model) {
                    setCurrentVeoModel(data.model);
                  }
                } else if (data.type === 'video') {
                  // Add video as it completes
                  if (data.provider === 'sora') {
                    setSoraVideos(prev => [...prev, { url: data.url, provider: 'sora' }]);
                    localSoraVideos++;
                    setGenerationStatus('Sora 2 video completed!');
                  } else if (data.provider === 'veo') {
                    setVeoVideos(prev => [...prev, { url: data.url, provider: 'veo' }]);
                    localVeoVideos++;
                    setGenerationStatus('Veo video completed!');
                  }
                } else if (data.type === 'error') {
                  console.log('[Video Gen] Error event:', data);
                  if (data.provider === 'sora') {
                    setSoraError(data.error);
                    localSoraError = data.error;
                  } else if (data.provider === 'veo') {
                    setVeoError(data.error);
                    localVeoError = data.error;
                  } else {
                    throw new Error(data.error);
                  }
                } else if (data.type === 'complete') {
                  completedProviders++;
                  setGenerationProgress(Math.floor((completedProviders / totalProviders) * 100));
                } else if (data.type === 'done') {
                  // All providers finished
                  setGenerationProgress(100);
                  setGenerationStatus('Complete!');
                }
              } catch (parseError) {
                console.error('[Video Gen] Failed to parse SSE event:', line, parseError);
              }
            }
          }
        }
      }
      
      // Clear progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      
      // Show completion toast based on local results
      const hasSoraError = !!localSoraError;
      const hasVeoError = !!localVeoError;
      const errorCount = [hasSoraError, hasVeoError].filter(Boolean).length;
      
      if (errorCount === 2) {
        toast({
          title: "Generation Failed",
          description: "Both Sora and Veo failed to generate videos. Please try again.",
          variant: "destructive",
        });
      } else if (errorCount === 1) {
        toast({
          title: "Partial Success",
          description: `${hasSoraError ? 'Sora' : 'Veo'} failed, but ${hasSoraError ? 'Veo' : 'Sora'} generated videos successfully.`,
        });
      } else if (localSoraVideos > 0 || localVeoVideos > 0) {
        toast({
          title: "Videos Generated!",
          description: `Successfully generated ${localSoraVideos + localVeoVideos} video(s).`,
        });
      } else {
        toast({
          title: "Generation Complete",
          description: "Video generation finished. Check results above.",
        });
      }
    } catch (error) {
      console.error('[Video Gen] Error:', error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
      
      // Clear progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (data: {
      url: string;
      productId: string;
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
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  const MAX_REFERENCE_IMAGES = 5;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const available = MAX_REFERENCE_IMAGES - referenceImages.length;
    const toAdd = files.slice(0, available);

    toAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setReferenceImages((prev) => [...prev, reader.result as string]);
        setReferenceImageFiles((prev) => [...prev, file]);
      };
      reader.readAsDataURL(file);
    });

    // Reset input so same files can be re-selected
    e.target.value = '';
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
    setReferenceImageFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = () => {
    if (!promptDetails.trim()) {
      toast({
        title: "Prompt Required",
        description: "Please provide prompt details for video generation.",
        variant: "destructive",
      });
      return;
    }

    if (generationType === 'image-to-video' && referenceImages.length === 0) {
      toast({
        title: "Reference Image Required",
        description: "Please upload at least one reference image for image-to-video generation.",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    formData.append('productId', selectedProductId);
    formData.append('promptDetails', promptDetails);
    formData.append('generationType', generationType);
    formData.append('duration', duration.toString());
    formData.append('amount', amount.toString());
    formData.append('aspectRatio', aspectRatio);
    for (const file of referenceImageFiles) {
      formData.append('referenceImage', file);
    }

    // Call the streaming video generation function
    generateVideosWithStreaming(formData);
  };

  const handleSaveClick = (video: GeneratedVideo) => {
    setVideoToSave(video);
    setSaveProductId(selectedProductId === "none" ? "none" : selectedProductId);
    setSaveDialogOpen(true);
  };

  const handleConfirmSave = () => {
    if (!videoToSave) return;

    saveMutation.mutate({
      url: videoToSave.url,
      productId: saveProductId,
      provider: videoToSave.provider,
      prompt: promptDetails,
      generationType,
      duration,
      aspectRatio,
      referenceImageUrls: referenceImages,
    });
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
          <div className="container mx-auto p-6 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h1 className="text-3xl font-bold">Video Generator</h1>
              <Badge variant="outline">Sora 2 & Veo 3 Fast</Badge>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Product Selection */}
              <div className="space-y-2">
                <Label htmlFor="product-select">Product</Label>
                <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                  <SelectTrigger id="product-select" data-testid="select-product">
                    <SelectValue placeholder="Select a product" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" data-testid="option-product-none">
                      No reference product
                    </SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id} data-testid={`option-product-${product.id}`}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Generation Type */}
              <div className="space-y-2">
                <Label>Generation Type</Label>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { value: 'text-to-video', label: 'Text to Video', desc: 'Generate from prompt only' },
                    { value: 'image-to-video', label: 'Image to Video', desc: 'Animate a single image' },
                  ].map((type) => (
                    <Card
                      key={type.value}
                      className={`cursor-pointer transition-colors ${
                        generationType === type.value ? 'border-primary bg-accent' : 'hover-elevate'
                      }`}
                      onClick={() => setGenerationType(type.value as 'text-to-video' | 'image-to-video')}
                      data-testid={`card-generation-type-${type.value}`}
                    >
                      <CardContent className="p-3">
                        <div className="font-medium">{type.label}</div>
                        <div className="text-xs text-muted-foreground">{type.desc}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Reference Images Upload */}
              {generationType === 'image-to-video' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Reference Images</Label>
                    <span className="text-xs text-muted-foreground">{referenceImages.length}/{MAX_REFERENCE_IMAGES}</span>
                  </div>

                  {/* Thumbnails grid */}
                  {referenceImages.length > 0 && (
                    <div className="grid grid-cols-2 gap-2" data-testid="reference-images-grid">
                      {referenceImages.map((src, idx) => (
                        <div key={idx} className="relative" data-testid={`reference-image-preview-${idx}`}>
                          <img
                            src={src}
                            alt={`Reference ${idx + 1}`}
                            className="w-full h-20 object-cover rounded-md border"
                          />
                          <Button
                            size="icon"
                            variant="destructive"
                            className="absolute top-1 right-1"
                            onClick={() => removeReferenceImage(idx)}
                            data-testid={`button-remove-reference-${idx}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload area — shown when slots are available */}
                  {referenceImages.length < MAX_REFERENCE_IMAGES && (
                    <div
                      className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover-elevate"
                      onClick={() => document.getElementById('reference-image-input')?.click()}
                      data-testid="upload-reference-image"
                    >
                      <Upload className="mx-auto h-6 w-6 text-muted-foreground mb-1" />
                      <p className="text-sm text-muted-foreground">
                        {referenceImages.length === 0 ? 'Click to upload reference images' : 'Add more images'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Up to {MAX_REFERENCE_IMAGES} images
                      </p>
                    </div>
                  )}

                  <input
                    id="reference-image-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </div>
              )}

              {/* Prompt Details */}
              <div className="space-y-2">
                <Label htmlFor="prompt-details">Video Prompt</Label>
                <Textarea
                  id="prompt-details"
                  placeholder="Describe the video you want to create..."
                  value={promptDetails}
                  onChange={(e) => setPromptDetails(e.target.value)}
                  rows={4}
                  data-testid="input-prompt"
                />
              </div>

              {/* Duration */}
              <div className="space-y-2">
                <Label htmlFor="duration-select">Video Length</Label>
                <Select value={duration.toString()} onValueChange={(v) => setDuration(parseInt(v))}>
                  <SelectTrigger id="duration-select" data-testid="select-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 seconds</SelectItem>
                    <SelectItem value="6">6 seconds</SelectItem>
                    <SelectItem value="8">8 seconds (default)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Amount of Variations */}
              <div className="space-y-2">
                <Label htmlFor="amount-select">Amount of Variations</Label>
                <Select value={amount.toString()} onValueChange={(v) => setAmount(parseInt(v))}>
                  <SelectTrigger id="amount-select" data-testid="select-amount">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 variation</SelectItem>
                    <SelectItem value="2">2 variations</SelectItem>
                    <SelectItem value="4">4 variations</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Aspect Ratio */}
              <div className="space-y-2">
                <Label htmlFor="aspect-ratio-select">Aspect Ratio</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger id="aspect-ratio-select" data-testid="select-aspect-ratio">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                    <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                    <SelectItem value="1:1">1:1 (Square)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Generate Button */}
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full"
                data-testid="button-generate"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <VideoIcon className="mr-2 h-4 w-4" />
                    Generate Videos
                  </>
                )}
              </Button>

              {/* Progress Bar */}
              {isGenerating && (
                <div className="space-y-2">
                  <Progress value={generationProgress} className="w-full" />
                  <p className="text-sm text-center text-muted-foreground">
                    {generationStatus}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Veo Results */}
          <Card>
            <Collapsible open={veoSectionOpen} onOpenChange={setVeoSectionOpen}>
              <CardHeader className="cursor-pointer" onClick={() => setVeoSectionOpen(!veoSectionOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle>{currentVeoModel} Videos</CardTitle>
                      <Badge variant="secondary" data-testid="badge-veo-count">
                        {veoVideos.length} {veoVideos.length === 1 ? 'video' : 'videos'}
                      </Badge>
                    </div>
                    {veoSectionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {veoError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Veo Error</AlertTitle>
                      <AlertDescription>{veoError}</AlertDescription>
                    </Alert>
                  )}
                  {veoVideos.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {veoVideos.map((video, index) => (
                        <div key={index} className="space-y-3" data-testid={`video-veo-${index}`}>
                          <video
                            src={video.url}
                            controls
                            className="w-full rounded-lg border"
                          />
                          
                          <Button
                            onClick={() => handleSaveClick(video)}
                            variant="outline"
                            className="w-full"
                            data-testid={`button-save-veo-${index}`}
                          >
                            <Save className="mr-2 h-4 w-4" />
                            Save to Library
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : !veoError ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No Veo videos generated yet. Click "Generate Videos" to start.
                    </p>
                  ) : null}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Sora Results */}
          <Card>
            <Collapsible open={soraSectionOpen} onOpenChange={setSoraSectionOpen}>
              <CardHeader className="cursor-pointer" onClick={() => setSoraSectionOpen(!soraSectionOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle>Sora 2 Videos</CardTitle>
                      <Badge variant="secondary" data-testid="badge-sora-count">
                        {soraVideos.length} {soraVideos.length === 1 ? 'video' : 'videos'}
                      </Badge>
                    </div>
                    {soraSectionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {soraError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Sora Error</AlertTitle>
                      <AlertDescription>{soraError}</AlertDescription>
                    </Alert>
                  )}
                  {soraVideos.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {soraVideos.map((video, index) => (
                        <div key={index} className="space-y-3" data-testid={`video-sora-${index}`}>
                          <video
                            src={video.url}
                            controls
                            className="w-full rounded-lg border"
                          />
                          
                          <Button
                            onClick={() => handleSaveClick(video)}
                            variant="outline"
                            className="w-full"
                            data-testid={`button-save-sora-${index}`}
                          >
                            <Save className="mr-2 h-4 w-4" />
                            Save to Library
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : !soraError ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No Sora videos generated yet. Click "Generate Videos" to start.
                    </p>
                  ) : null}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>
      </div>

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
              <Label htmlFor="save-product-select">Associate with Product (Optional)</Label>
              <Select value={saveProductId} onValueChange={setSaveProductId}>
                <SelectTrigger id="save-product-select" data-testid="select-save-product">
                  <SelectValue placeholder="No product association" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" data-testid="option-save-product-none">
                    No product association
                  </SelectItem>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id} data-testid={`option-save-product-${product.id}`}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
          </div>
        </TabsContent>
        
        <TabsContent value="helper" className="flex-1 overflow-auto mt-0">
          <VideoPromptHelper />
        </TabsContent>
      </Tabs>
    </div>
  );
}
