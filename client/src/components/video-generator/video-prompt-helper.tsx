import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Loader2, Upload, X, Sparkles, Copy, Check, Video, FolderOpen } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import MtpImagePicker from "@/components/mtp-image-picker";

const STORAGE_KEY_IDEA = "videoPromptHelper_idea";
const STORAGE_KEY_IMAGES = "videoPromptHelper_referenceImages";
const STORAGE_KEY_IMAGE_MTP_KEYS = "videoPromptHelper_referenceImageMtpKeys";
const STORAGE_KEY_PROMPTS = "videoPromptHelper_generatedPrompts";

function loadFromSession<T>(key: string, fallback: T): T {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch {}
  return fallback;
}

function getDisplaySrc(base64: string, mtpKey: string): string {
  if (mtpKey) return `/api/mtp-images/proxy/${encodeURIComponent(mtpKey)}`;
  return base64;
}

export default function VideoPromptHelper() {
  const { toast } = useToast();
  const [idea, setIdea] = useState(() => loadFromSession<string>(STORAGE_KEY_IDEA, ""));
  const [referenceImages, setReferenceImages] = useState<string[]>(() => loadFromSession<string[]>(STORAGE_KEY_IMAGES, []));
  const [referenceImageMtpKeys, setReferenceImageMtpKeys] = useState<string[]>(() => loadFromSession<string[]>(STORAGE_KEY_IMAGE_MTP_KEYS, []));
  const [generatedPrompts, setGeneratedPrompts] = useState<string[]>(() => loadFromSession<string[]>(STORAGE_KEY_PROMPTS, []));
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [mtpPickerOpen, setMtpPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY_IDEA, JSON.stringify(idea));
  }, [idea]);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_IMAGES, JSON.stringify(referenceImages)); } catch {}
  }, [referenceImages]);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_IMAGE_MTP_KEYS, JSON.stringify(referenceImageMtpKeys)); } catch {}
  }, [referenceImageMtpKeys]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(generatedPrompts));
  }, [generatedPrompts]);

  const handleReferenceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setReferenceImages(prev => [...prev, reader.result as string]);
        setReferenceImageMtpKeys(prev => [...prev, '']);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
    setReferenceImageMtpKeys(prev => prev.filter((_, i) => i !== index));
  };

  const handleMtpImageSelect = (image: { url: string; key: string }) => {
    setReferenceImages(prev => [...prev, '']);
    setReferenceImageMtpKeys(prev => [...prev, image.key]);
  };

  const hasAnyReferenceImages = referenceImages.some(img => img) || referenceImageMtpKeys.some(k => k);

  const generatePromptsMutation = useMutation<{ prompts: string[] }, Error, void>({
    mutationFn: async () => {
      const base64Images = referenceImages.filter(img => img && img.startsWith('data:'));
      const mtpKeys = referenceImageMtpKeys.filter(k => k);
      const response = await apiRequest("POST", "/api/video-prompts/generate", {
        idea: idea.trim() || undefined,
        referenceImages: base64Images.length > 0 ? base64Images : undefined,
        referenceImageMtpKeys: mtpKeys.length > 0 ? mtpKeys : undefined,
      });
      return await response.json();
    },
    onSuccess: (data: { prompts: string[] }) => {
      setGeneratedPrompts(data.prompts);
      toast({
        title: "Video prompts generated",
        description: `Claude generated ${data.prompts.length} video prompts for you`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Generation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleGenerate = () => {
    if (!idea.trim() && !hasAnyReferenceImages) {
      toast({
        title: "Input required",
        description: "Please provide either an idea or reference images",
        variant: "destructive",
      });
      return;
    }
    generatePromptsMutation.mutate();
  };

  const handleCopy = async (prompt: string, index: number) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
      toast({ title: "Copied to clipboard", description: "Video prompt copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", description: "Failed to copy prompt to clipboard", variant: "destructive" });
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Video Prompt Helper</h1>
        <p className="text-muted-foreground">
          Get detailed video prompts from Claude optimized for Sora and Veo models. Describe motion, camera angles, pacing, and visual style.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="video-idea">Describe Your Video Idea (Optional)</Label>
            <Textarea
              id="video-idea"
              placeholder="I want to create a cinematic product reveal for a luxury perfume bottle. The camera should slowly pan around the product with dramatic lighting, soft focus bokeh in the background, and elegant particle effects..."
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              className="min-h-[150px]"
              data-testid="textarea-video-idea"
            />
          </div>

          <div className="space-y-2">
            <Label>Reference Images (Optional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleReferenceImageChange}
              className="hidden"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1"
                data-testid="button-upload-video-reference"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload Images
              </Button>
              <Button
                variant="outline"
                onClick={() => setMtpPickerOpen(true)}
                data-testid="button-browse-mtp-video-helper"
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
                      <img
                        src={displaySrc}
                        alt={`Reference ${idx + 1}`}
                        className="w-full h-24 object-cover rounded"
                      />
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeReferenceImage(idx)}
                        data-testid={`button-remove-video-ref-${idx}`}
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
            <Video className="h-4 w-4" />
            <AlertDescription>
              Provide an idea, reference images from your library, or both. Claude will generate detailed video prompts
              including camera movements, motion dynamics, lighting, pacing, and visual transitions
              optimized for AI video generation (Sora, Veo).
            </AlertDescription>
          </Alert>

          <Button
            onClick={handleGenerate}
            disabled={generatePromptsMutation.isPending || (!idea.trim() && !hasAnyReferenceImages)}
            className="w-full"
            data-testid="button-generate-video-prompts"
          >
            {generatePromptsMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Video Prompts...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Video Prompts with Claude
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {generatedPrompts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Generated Video Prompts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {generatedPrompts.map((prompt, idx) => (
              <Card key={idx} className="bg-muted/50">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-sm">Video Prompt {idx + 1}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{prompt}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopy(prompt, idx)}
                      data-testid={`button-copy-video-prompt-${idx}`}
                    >
                      {copiedIndex === idx ? (
                        <><Check className="h-4 w-4 mr-1" />Copied</>
                      ) : (
                        <><Copy className="h-4 w-4 mr-1" />Copy</>
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
        description="Browse your MTP-Images library to select a reference image for video prompt generation"
      />
    </div>
  );
}
