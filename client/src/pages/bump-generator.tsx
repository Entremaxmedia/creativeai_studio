import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Loader2, AlertCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

interface BumpVariation {
  headlines: string[];
  body: string;
}

export default function BumpGeneratorPage() {
  const { toast } = useToast();
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const [productName, setProductName] = useState("");
  const [productInfo, setProductInfo] = useState("");
  const [retailPrice, setRetailPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  
  const [gptVariations, setGptVariations] = useState<BumpVariation[]>([]);
  const [claudeVariations, setClaudeVariations] = useState<BumpVariation[]>([]);
  const [gptError, setGptError] = useState<string | null>(null);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [gptSectionOpen, setGptSectionOpen] = useState(true);
  const [claudeSectionOpen, setClaudeSectionOpen] = useState(true);
  
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState("");
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load persisted state from localStorage on mount
  useEffect(() => {
    const loadPersistedState = () => {
      try {
        const saved = localStorage.getItem('bumpGeneratorState');
        if (saved) {
          const state = JSON.parse(saved);
          setProductName(state.productName || "");
          setProductInfo(state.productInfo || "");
          setRetailPrice(state.retailPrice || "");
          setSalePrice(state.salePrice || "");
          setGptVariations(state.gptVariations || []);
          setClaudeVariations(state.claudeVariations || []);
          setGptError(state.gptError || null);
          setClaudeError(state.claudeError || null);
          setGptSectionOpen(state.gptSectionOpen ?? true);
          setClaudeSectionOpen(state.claudeSectionOpen ?? true);
        }
      } catch (error) {
        console.error("Failed to load persisted bump generator state:", error);
      }
    };
    
    loadPersistedState();
  }, []);

  // Persist state to localStorage whenever it changes
  useEffect(() => {
    try {
      const state = {
        productName,
        productInfo,
        retailPrice,
        salePrice,
        gptVariations,
        claudeVariations,
        gptError,
        claudeError,
        gptSectionOpen,
        claudeSectionOpen,
      };
      localStorage.setItem('bumpGeneratorState', JSON.stringify(state));
    } catch (error) {
      console.error("Failed to persist bump generator state:", error);
    }
  }, [productName, productInfo, retailPrice, salePrice, gptVariations, claudeVariations, gptError, claudeError, gptSectionOpen, claudeSectionOpen]);

  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  const generateMutation = useMutation({
    mutationFn: async (data: { productName: string; productInfo: string; retailPrice: string; salePrice: string }) => {
      // Defensive abort of any pending request
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      
      // Clear any existing interval before starting a new one
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      
      setGenerationProgress(0);
      setGenerationStatus("Preparing bump copy generation...");
      
      // Start smooth progress animation
      let progress = 0;
      progressIntervalRef.current = setInterval(() => {
        progress += Math.random() * 3;
        if (progress < 90) {
          setGenerationProgress(Math.floor(progress));
          
          if (progress < 30) {
            setGenerationStatus("Analyzing product details...");
          } else if (progress < 60) {
            setGenerationStatus("Generating GPT-5 variations...");
          } else if (progress < 85) {
            setGenerationStatus("Generating Claude variations...");
          } else {
            setGenerationStatus("Finalizing bump copy...");
          }
        }
      }, 200);
      
      const res = await fetch("/api/generate-bump-copy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
        signal: abortControllerRef.current.signal,
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to generate bump copy" }));
        throw new Error(errorData.error || "Failed to generate bump copy");
      }
      
      return await res.json();
    },
    onSuccess: (data) => {
      setGenerationProgress(100);
      setGenerationStatus("Complete!");
      
      console.log("Bump generation response:", data);
      setGptVariations(data.gptVariations || []);
      setClaudeVariations(data.claudeVariations || []);
      setGptError(data.errors?.gpt || null);
      setClaudeError(data.errors?.claude || null);
      
      if (data.errors?.gpt && data.errors?.claude) {
        toast({
          title: "Generation Failed",
          description: "Both AI providers encountered errors. Check the error messages below.",
          variant: "destructive",
        });
      } else if (data.errors?.gpt) {
        toast({
          title: "Partial Success",
          description: "GPT-5 encountered an error, but Claude variations were generated.",
          variant: "default",
        });
      } else if (data.errors?.claude) {
        toast({
          title: "Partial Success",
          description: "Claude encountered an error, but GPT-5 variations were generated.",
          variant: "default",
        });
      } else {
        toast({
          title: "Success",
          description: `Generated ${data.gptVariations.length + data.claudeVariations.length} bump variations`,
        });
      }
      
      // Reset progress after showing completion
      setTimeout(() => {
        setGenerationProgress(0);
        setGenerationStatus("");
      }, 1000);
    },
    onError: (error: any) => {
      setGenerationProgress(0);
      setGenerationStatus("");
      
      if (error?.name === 'AbortError') {
        toast({
          title: "Generation Cancelled",
          description: "Bump copy generation was cancelled successfully",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to generate bump copy",
          variant: "destructive",
        });
        console.error("Error generating bump copy:", error);
      }
    },
    onSettled: () => {
      // Always clear the interval regardless of success or error
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      abortControllerRef.current = null;
    },
  });
  
  // Handle cancel generation
  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setGenerationProgress(0);
      setGenerationStatus("");
    }
  };

  const handleGenerate = () => {
    if (!productName || !productInfo || !retailPrice || !salePrice) {
      toast({
        title: "Missing Information",
        description: "Please fill in all fields before generating",
        variant: "destructive",
      });
      return;
    }

    generateMutation.mutate({
      productName,
      productInfo,
      retailPrice,
      salePrice,
    });
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Bump Generator</h1>
        <p className="text-muted-foreground mt-2">
          Create high-performing ClickFunnels bump copy for your products
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Product Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="product-name">Product Name</Label>
                <Input
                  id="product-name"
                  placeholder="e.g., Tactical Flashlight"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  data-testid="input-product-name"
                />
              </div>

              <div>
                <Label htmlFor="retail-price">Retail Price</Label>
                <Input
                  id="retail-price"
                  placeholder="e.g., $79.99"
                  value={retailPrice}
                  onChange={(e) => setRetailPrice(e.target.value)}
                  data-testid="input-retail-price"
                />
              </div>

              <div>
                <Label htmlFor="sale-price">Sale Price</Label>
                <Input
                  id="sale-price"
                  placeholder="e.g., $29.99"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  data-testid="input-sale-price"
                />
              </div>

              <div>
                <Label htmlFor="product-info">Product Info</Label>
                <Textarea
                  id="product-info"
                  placeholder="Enter product details, features, benefits..."
                  value={productInfo}
                  onChange={(e) => setProductInfo(e.target.value)}
                  className="min-h-[200px]"
                  data-testid="textarea-product-info"
                />
              </div>

              {generateMutation.isPending ? (
                <Button
                  onClick={handleCancelGeneration}
                  variant="destructive"
                  className="w-full"
                  data-testid="button-cancel-bump"
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel Generation
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                  className="w-full"
                  data-testid="button-generate-bump"
                >
                  Generate Bump Copy
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Variations Display */}
        <div className="lg:col-span-2 space-y-4">
          {/* Progress Bar - show during generation or when showing completion */}
          {(generateMutation.isPending || generationProgress > 0) && (
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
          
          {gptVariations.length === 0 && claudeVariations.length === 0 && !generateMutation.isPending && (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <p>Fill in the product details and click Generate to create bump copy variations</p>
              </CardContent>
            </Card>
          )}

          {/* Claude Variations or Error */}
          {claudeError && (
            <Alert variant={claudeVariations.length > 0 ? "default" : "destructive"}>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{claudeVariations.length > 0 ? "Claude Partial Success" : "Claude Generation Failed"}</AlertTitle>
              <AlertDescription>
                {claudeError.includes("credit balance") 
                  ? "Claude API credit balance is too low. Please upgrade or purchase credits in your Anthropic account."
                  : claudeError}
              </AlertDescription>
            </Alert>
          )}
          
          {claudeVariations.length > 0 && (
            <Collapsible open={claudeSectionOpen} onOpenChange={setClaudeSectionOpen}>
              <Card>
                <CardHeader>
                  <CollapsibleTrigger className="flex items-center justify-between w-full" data-testid="toggle-claude-section">
                    <div className="flex items-center gap-2">
                      <CardTitle>Claude Sonnet 4 Variations</CardTitle>
                      <Badge variant="secondary">{claudeVariations.length}</Badge>
                    </div>
                    {claudeSectionOpen ? (
                      <ChevronUp className="h-5 w-5" />
                    ) : (
                      <ChevronDown className="h-5 w-5" />
                    )}
                  </CollapsibleTrigger>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="space-y-4">
                    {claudeVariations.map((variation, idx) => (
                      <Card key={idx} className="border-2" data-testid={`bump-variation-claude-${idx}`}>
                        <CardHeader>
                          <CardTitle className="text-lg">Variation {idx + 1}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {/* Headlines */}
                          <div>
                            <Label className="text-sm font-semibold">Headlines</Label>
                            <div className="space-y-2 mt-2">
                              {variation.headlines.map((headline, hIdx) => (
                                <div key={hIdx} className="flex items-start gap-2">
                                  <Badge variant="outline" className="shrink-0">
                                    {hIdx + 1}
                                  </Badge>
                                  <p className="text-sm font-medium">{headline}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Body */}
                          <div>
                            <Label className="text-sm font-semibold">Copy</Label>
                            <Card className="mt-2 p-4 bg-muted">
                              <div
                                className="prose prose-sm max-w-none"
                                dangerouslySetInnerHTML={{ __html: variation.body }}
                              />
                            </Card>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* GPT-5 Variations or Error */}
          {gptError && (
            <Alert variant={gptVariations.length > 0 ? "default" : "destructive"}>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{gptVariations.length > 0 ? "GPT-5 Partial Success" : "GPT-5 Generation Failed"}</AlertTitle>
              <AlertDescription>
                {gptError}
              </AlertDescription>
            </Alert>
          )}
          
          {gptVariations.length > 0 && (
            <Collapsible open={gptSectionOpen} onOpenChange={setGptSectionOpen}>
              <Card>
                <CardHeader>
                  <CollapsibleTrigger className="flex items-center justify-between w-full" data-testid="toggle-gpt-section">
                    <div className="flex items-center gap-2">
                      <CardTitle>GPT-5 Variations</CardTitle>
                      <Badge variant="secondary">{gptVariations.length}</Badge>
                    </div>
                    {gptSectionOpen ? (
                      <ChevronUp className="h-5 w-5" />
                    ) : (
                      <ChevronDown className="h-5 w-5" />
                    )}
                  </CollapsibleTrigger>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="space-y-4">
                    {gptVariations.map((variation, idx) => (
                      <Card key={idx} className="border-2" data-testid={`bump-variation-gpt-${idx}`}>
                        <CardHeader>
                          <CardTitle className="text-lg">Variation {idx + 1}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {/* Headlines */}
                          <div>
                            <Label className="text-sm font-semibold">Headlines</Label>
                            <div className="space-y-2 mt-2">
                              {variation.headlines.map((headline, hIdx) => (
                                <div key={hIdx} className="flex items-start gap-2">
                                  <Badge variant="outline" className="shrink-0">
                                    {hIdx + 1}
                                  </Badge>
                                  <p className="text-sm font-medium">{headline}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Body */}
                          <div>
                            <Label className="text-sm font-semibold">Copy</Label>
                            <Card className="mt-2 p-4 bg-muted">
                              <div
                                className="prose prose-sm max-w-none"
                                dangerouslySetInnerHTML={{ __html: variation.body }}
                              />
                            </Card>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}
        </div>
      </div>
    </div>
  );
}
