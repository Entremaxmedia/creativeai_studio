import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Loader2, Upload, X, Sparkles, Copy, Check, FolderOpen, CheckSquare, Square, ArrowRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import MtpImagePicker from "@/components/mtp-image-picker";

const STORAGE_KEY_IDEA = "promptHelper_idea";
const STORAGE_KEY_IMAGES = "promptHelper_referenceImages";
const STORAGE_KEY_IMAGE_URLS = "promptHelper_referenceImageUrls";
const STORAGE_KEY_IMAGE_MTP_KEYS = "promptHelper_referenceImageMtpKeys";
const STORAGE_KEY_PROMPTS = "promptHelper_generatedPrompts";

function loadFromSession<T>(key: string, fallback: T): T {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch {}
  return fallback;
}

function getDisplaySrc(base64: string, mtpKey: string): string {
  if (mtpKey) {
    return `/api/mtp-images/proxy/${encodeURIComponent(mtpKey)}`;
  }
  return base64;
}

type PromptJobListener = () => void;

interface PromptJobState {
  isRunning: boolean;
  generatedPrompts: string[];
  error: string | null;
}

const promptHelperJob = {
  _state: null as PromptJobState | null,
  _listeners: new Set<PromptJobListener>(),

  get state(): PromptJobState | null {
    return this._state;
  },

  subscribe(listener: PromptJobListener) {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  },

  _notify() {
    if (this._state) {
      try {
        sessionStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(this._state.generatedPrompts));
      } catch {}
    }
    this._listeners.forEach(l => l());
  },

  async start(params: {
    idea: string;
    referenceImages: string[];
    referenceImageMtpKeys: string[];
  }): Promise<{ prompts: string[] } | null> {
    if (this._state?.isRunning) return null;

    this._state = { isRunning: true, generatedPrompts: [], error: null };
    this._notify();

    try {
      const base64Images = params.referenceImages.filter(img => img && img.startsWith('data:'));
      const mtpKeys = params.referenceImageMtpKeys.filter(k => k);

      const response = await fetch("/api/image-prompts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: params.idea.trim(),
          referenceImages: base64Images.length > 0 ? base64Images : undefined,
          referenceImageMtpKeys: mtpKeys.length > 0 ? mtpKeys : undefined,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Failed to generate prompts" }));
        throw new Error(errData.error || errData.message || "Failed to generate prompts");
      }

      const data = await response.json();
      this._state = { isRunning: false, generatedPrompts: data.prompts || [], error: null };
      this._notify();
      return data;
    } catch (err: any) {
      this._state = { isRunning: false, generatedPrompts: [], error: err.message };
      this._notify();
      throw err;
    }
  },
};

interface ImagePromptHelperProps {
  onSwitchToMassGenerator?: () => void;
}

export default function ImagePromptHelper({ onSwitchToMassGenerator }: ImagePromptHelperProps) {
  const { toast } = useToast();
  const [idea, setIdea] = useState(() => loadFromSession<string>(STORAGE_KEY_IDEA, ""));
  const [referenceImages, setReferenceImages] = useState<string[]>(() => loadFromSession<string[]>(STORAGE_KEY_IMAGES, []));
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>(() => loadFromSession<string[]>(STORAGE_KEY_IMAGE_URLS, []));
  const [referenceImageMtpKeys, setReferenceImageMtpKeys] = useState<string[]>(() => loadFromSession<string[]>(STORAGE_KEY_IMAGE_MTP_KEYS, []));
  const [generatedPrompts, setGeneratedPrompts] = useState<string[]>(() => {
    const job = promptHelperJob.state;
    if (job && job.generatedPrompts.length > 0) return job.generatedPrompts;
    return loadFromSession<string[]>(STORAGE_KEY_PROMPTS, []);
  });
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(() => !!promptHelperJob.state?.isRunning);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [selectedPrompts, setSelectedPrompts] = useState<Set<number>>(new Set());
  const [mtpPickerOpen, setMtpPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = promptHelperJob.subscribe(() => {
      const job = promptHelperJob.state;
      if (!job) return;
      setIsGeneratingPrompts(job.isRunning);
      if (job.generatedPrompts.length > 0) {
        setGeneratedPrompts(job.generatedPrompts);
      }
    });
    return unsub;
  }, []);

  const togglePromptSelection = (index: number) => {
    setSelectedPrompts(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleAllPrompts = () => {
    if (selectedPrompts.size === generatedPrompts.length) {
      setSelectedPrompts(new Set());
    } else {
      setSelectedPrompts(new Set(generatedPrompts.map((_, i) => i)));
    }
  };

  const sendToMassGenerator = (prompts: string[]) => {
    const promptsText = prompts.join("\n\n");
    sessionStorage.setItem("massGen_prompts", JSON.stringify(promptsText));
    sessionStorage.setItem("massGen_results", JSON.stringify([]));
    try {
      sessionStorage.setItem("massGen_referenceImages", JSON.stringify(referenceImages));
      sessionStorage.setItem("massGen_referenceImageUrls", JSON.stringify(referenceImageUrls));
      sessionStorage.setItem("massGen_referenceImageMtpKeys", JSON.stringify(referenceImageMtpKeys));
    } catch {}
    onSwitchToMassGenerator?.();
    toast({
      title: "Prompts sent to Mass Generator",
      description: `${prompts.length} prompt${prompts.length > 1 ? 's' : ''} loaded into Mass Image Generator`,
    });
  };

  const handleUseAllPrompts = () => {
    sendToMassGenerator(generatedPrompts);
  };

  const handleUseSelectedPrompts = () => {
    const selected = generatedPrompts.filter((_, i) => selectedPrompts.has(i));
    if (selected.length === 0) {
      toast({
        title: "No prompts selected",
        description: "Select at least one prompt to send to the Mass Generator",
        variant: "destructive",
      });
      return;
    }
    sendToMassGenerator(selected);
  };

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY_IDEA, JSON.stringify(idea));
  }, [idea]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_IMAGES, JSON.stringify(referenceImages));
    } catch {
      sessionStorage.removeItem(STORAGE_KEY_IMAGES);
    }
  }, [referenceImages]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_IMAGE_URLS, JSON.stringify(referenceImageUrls));
    } catch {}
  }, [referenceImageUrls]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_IMAGE_MTP_KEYS, JSON.stringify(referenceImageMtpKeys));
    } catch {}
  }, [referenceImageMtpKeys]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(generatedPrompts));
  }, [generatedPrompts]);


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

  const hasAnyReferenceImages = referenceImages.some(img => img) || referenceImageMtpKeys.some(k => k);

  const handleGenerate = async () => {
    if (!idea.trim() && !hasAnyReferenceImages) {
      toast({
        title: "Input required",
        description: "Please provide either an idea or reference images",
        variant: "destructive",
      });
      return;
    }

    try {
      const data = await promptHelperJob.start({
        idea: idea,
        referenceImages: [...referenceImages],
        referenceImageMtpKeys: [...referenceImageMtpKeys],
      });
      if (data && data.prompts) {
        toast({
          title: "Prompts generated",
          description: `Claude generated ${data.prompts.length} image prompts for you`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Generation failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleCopy = async (prompt: string, index: number) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
      toast({
        title: "Copied to clipboard",
        description: "Prompt copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Failed to copy prompt to clipboard",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Image Prompt Helper</h1>
        <p className="text-muted-foreground">
          Get thorough, detailed image prompts from Claude by providing reference images and/or describing your idea.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="idea">Describe Your Idea (Optional)</Label>
            <Textarea
              id="idea"
              placeholder="I want to create product images for a luxury watch with a sophisticated, elegant feel. The watch should be displayed on a dark surface with dramatic lighting..."
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              className="min-h-[150px]"
              data-testid="textarea-idea"
            />
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
                <Upload className="h-4 w-4 mr-2" />
                Upload Reference Images
              </Button>
              <Button
                variant="outline"
                onClick={() => setMtpPickerOpen(true)}
                data-testid="button-browse-mtp-helper"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                MTP-Images
              </Button>
            </div>
            {hasAnyReferenceImages && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {referenceImages.map((img, idx) => {
                  const displaySrc = getDisplaySrc(img, referenceImageMtpKeys[idx] || '');
                  if (!displaySrc) return null;
                  return (
                    <div key={idx} className="relative group">
                      <img src={displaySrc} alt={`Reference ${idx + 1}`} className="w-full object-contain rounded" />
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeReferenceImage(idx)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      {referenceImageMtpKeys[idx] && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-1 py-0.5 truncate rounded-b">
                          MTP
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertDescription>
              Provide either an idea, reference images, or both. Claude will analyze your input and generate detailed, 
              thorough prompts optimized for AI image generation.
            </AlertDescription>
          </Alert>

          <Button
            onClick={handleGenerate}
            disabled={isGeneratingPrompts || (!idea.trim() && !hasAnyReferenceImages)}
            className="w-full"
            data-testid="button-generate"
          >
            {isGeneratingPrompts ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Prompts...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Prompts with Claude
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Prompts */}
      {generatedPrompts.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle>Generated Prompts</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleAllPrompts}
                  data-testid="button-toggle-all-prompts"
                >
                  {selectedPrompts.size === generatedPrompts.length ? (
                    <CheckSquare className="h-4 w-4 mr-1" />
                  ) : (
                    <Square className="h-4 w-4 mr-1" />
                  )}
                  {selectedPrompts.size === generatedPrompts.length ? "Deselect All" : "Select All"}
                </Button>
                {selectedPrompts.size > 0 && (
                  <Button
                    size="sm"
                    onClick={handleUseSelectedPrompts}
                    data-testid="button-use-selected-prompts"
                  >
                    <ArrowRight className="h-4 w-4 mr-1" />
                    Use {selectedPrompts.size} Selected
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleUseAllPrompts}
                  data-testid="button-use-all-prompts"
                >
                  <ArrowRight className="h-4 w-4 mr-1" />
                  Use All Prompts
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {generatedPrompts.map((prompt, idx) => (
              <Card key={idx} className={`bg-muted/50 ${selectedPrompts.has(idx) ? 'ring-2 ring-primary' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Button
                      size="icon"
                      variant={selectedPrompts.has(idx) ? "default" : "outline"}
                      className="mt-0.5 shrink-0"
                      onClick={() => togglePromptSelection(idx)}
                      data-testid={`button-select-prompt-${idx}`}
                    >
                      {selectedPrompts.has(idx) ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </Button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-sm">Prompt {idx + 1}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{prompt}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => handleCopy(prompt, idx)}
                      data-testid={`button-copy-${idx}`}
                    >
                      {copiedIndex === idx ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}

      <MtpImagePicker
        open={mtpPickerOpen}
        onOpenChange={setMtpPickerOpen}
        onSelect={handleMtpImageSelect}
        title="Select Reference Image"
        description="Browse your MTP-Images library to select a reference image for prompt generation"
      />
    </div>
  );
}
