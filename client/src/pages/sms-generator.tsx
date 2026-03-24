import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Product } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, MessageSquare, ChevronDown, Check, ChevronsUpDown, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";

const BRANDS = [
  "MyTacticalPromos",
  "PatriotAddict",
  "TacticalBox",
  "ApeSurvival",
  "TacticalADay"
];

interface SmsVariation {
  type: "sms" | "mms";
  message: string;
  characterCount: number;
  aiProvider: "claude" | "gpt";
}

// Calculate character count with tag conversions
function calculateCharacterCount(message: string): number {
  return message
    .replace(/\{productUrl\}/g, 'https://mtpdls.com/xxxxx')
    .replace(/\{firstName\}/g, '{firstName}')
    .replace(/\{state\}/g, '{state}')
    .length;
}

// Convert message for preview (show actual URL)
function convertMessageForPreview(message: string): string {
  return message
    .replace(/\{productUrl\}/g, 'https://mtpdls.com/xxxxx')
    .replace(/\{firstName\}/g, '{firstName}')
    .replace(/\{state\}/g, '{state}');
}

function SmsVariationCard({ variation, index, provider }: { variation: SmsVariation; index: number; provider: string }) {
  const [editedMessage, setEditedMessage] = useState(variation.message);
  const [isOpen, setIsOpen] = useState(false);
  const charCount = calculateCharacterCount(editedMessage);
  const maxChars = variation.type === "sms" ? 160 : 1600;
  const isOverLimit = charCount > maxChars;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="w-full" data-testid={`card-sms-${provider}-${index}`}>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover-elevate" data-testid={`trigger-${provider}-${index}`}>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Variation {index + 1}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={variation.type === "sms" ? "default" : "secondary"} data-testid={`badge-type-${provider}-${index}`}>
                  {variation.type.toUpperCase()}
                </Badge>
                <Badge variant={isOverLimit ? "destructive" : "outline"} data-testid={`badge-char-count-${provider}-${index}`}>
                  {charCount}/{maxChars}
                </Badge>
                <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">
            <div>
              <Label htmlFor={`editor-${provider}-${index}`} className="text-sm font-medium">
                Edit Message
              </Label>
              <Textarea
                id={`editor-${provider}-${index}`}
                data-testid={`textarea-editor-${provider}-${index}`}
                value={editedMessage}
                onChange={(e) => setEditedMessage(e.target.value)}
                className="min-h-[100px] font-mono text-sm mt-1.5"
                placeholder="Edit your SMS message..."
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Preview (with converted tags)</Label>
              <div className="mt-1.5 p-3 bg-muted rounded-md text-sm font-mono whitespace-pre-wrap break-words" data-testid={`preview-${provider}-${index}`}>
                {convertMessageForPreview(editedMessage)}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function SmsGenerator() {
  const { toast } = useToast();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [brand, setBrand] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [offerSearchOpen, setOfferSearchOpen] = useState(false);
  const [angle, setAngle] = useState("");
  
  const [claudeVariations, setClaudeVariations] = useState<SmsVariation[]>([]);
  const [gptVariations, setGptVariations] = useState<SmsVariation[]>([]);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [gptError, setGptError] = useState<string | null>(null);
  const [smsProgress, setSmsProgress] = useState<number>(0);

  // Fetch products
  const { data: productsData, isLoading: isLoadingProducts } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ["/api/products"],
  });

  const products = productsData?.products || [];

  // Generate SMS mutation
  const generateMutation = useMutation({
    mutationFn: async (data: { brand: string; productId: string; angle?: string }) => {
      // Defensive abort of any pending request
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      
      const response = await fetch("/api/generate-sms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
        signal: abortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to generate SMS" }));
        throw new Error(errorData.error || "Failed to generate SMS");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setClaudeVariations(data.claudeVariations || []);
        setGptVariations(data.gptVariations || []);
        setClaudeError(data.errors?.claude || null);
        setGptError(data.errors?.gpt || null);

        if (data.claudeVariations?.length > 0 || data.gptVariations?.length > 0) {
          toast({
            title: "SMS Generated Successfully",
            description: `Generated ${data.claudeVariations?.length || 0} Claude variations and ${data.gptVariations?.length || 0} GPT variations`,
          });
        } else {
          toast({
            title: "Generation Failed",
            description: "Both AI models failed to generate SMS variations",
            variant: "destructive",
          });
        }
      }
    },
    onError: (error: any) => {
      if (error?.name === 'AbortError') {
        toast({
          title: "Generation Cancelled",
          description: "SMS generation was cancelled successfully",
        });
      } else {
        toast({
          title: "Generation Failed",
          description: error instanceof Error ? error.message : "An unexpected error occurred",
          variant: "destructive",
        });
      }
    },
    onSettled: () => {
      abortControllerRef.current = null;
    },
  });
  
  // Handle cancel generation
  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setProgress(0);
    }
  };

  const handleGenerate = () => {
    if (!brand || !selectedProductId) {
      toast({
        title: "Missing Required Fields",
        description: "Please select both a brand and an offer",
        variant: "destructive",
      });
      return;
    }

    setClaudeVariations([]);
    setGptVariations([]);
    setClaudeError(null);
    setGptError(null);

    generateMutation.mutate({
      brand,
      productId: selectedProductId,
      angle: angle || undefined,
    });
  };

  // Smooth progress animation for SMS generation
  useEffect(() => {
    if (generateMutation.isPending) {
      setSmsProgress(0);
      
      const duration = 15000; // 15 seconds to reach ~95%
      const interval = 50; // Update every 50ms
      const increment = (95 / duration) * interval;
      
      const timer = setInterval(() => {
        setSmsProgress(prev => {
          const next = prev + increment;
          return next >= 95 ? 95 : next;
        });
      }, interval);
      
      return () => clearInterval(timer);
    } else {
      // Complete the progress bar when generation finishes
      if (smsProgress > 0) {
        setSmsProgress(100);
        setTimeout(() => setSmsProgress(0), 500);
      }
    }
  }, [generateMutation.isPending]);

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-sms-generator">
          SMS Generator
        </h1>
        <p className="text-muted-foreground">
          Create high-performing marketing SMS/MMS campaigns with AI
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Set up your SMS campaign parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="brand-select">Brand *</Label>
                <Select value={brand} onValueChange={setBrand}>
                  <SelectTrigger id="brand-select" data-testid="select-brand">
                    <SelectValue placeholder="Select brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {BRANDS.map((b) => (
                      <SelectItem key={b} value={b} data-testid={`option-brand-${b}`}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="product-select">Offer *</Label>
                <Popover open={offerSearchOpen} onOpenChange={setOfferSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={offerSearchOpen}
                      className="w-full justify-between"
                      id="product-select"
                      data-testid="select-offer"
                      disabled={isLoadingProducts}
                    >
                      {isLoadingProducts 
                        ? "Loading..." 
                        : selectedProductId 
                          ? products.find((product) => product.id === selectedProductId)?.displayName || 
                            products.find((product) => product.id === selectedProductId)?.name || "Select offer" 
                          : "Select offer"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0">
                    <Command>
                      <CommandInput placeholder="Search offers..." data-testid="input-search-offer" />
                      <CommandList>
                        <CommandEmpty>No offer found.</CommandEmpty>
                        <CommandGroup>
                          {products.map((product) => (
                            <CommandItem
                              key={product.id}
                              value={product.displayName || product.name}
                              onSelect={() => {
                                setSelectedProductId(product.id);
                                setOfferSearchOpen(false);
                              }}
                              data-testid={`option-offer-${product.id}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedProductId === product.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {product.displayName || product.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="angle-input">Angle (Optional)</Label>
                <Input
                  id="angle-input"
                  data-testid="input-angle"
                  placeholder="e.g., urgent, friendly, exclusive"
                  value={angle}
                  onChange={(e) => setAngle(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Provide additional insight for the wording style
                </p>
              </div>

              {generateMutation.isPending ? (
                <Button
                  onClick={handleCancelGeneration}
                  variant="destructive"
                  className="w-full"
                  data-testid="button-cancel-sms"
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel Generation
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={!brand || !selectedProductId}
                  className="w-full"
                  data-testid="button-generate-sms"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate SMS
                </Button>
              )}

              <div className="pt-4 space-y-2 text-sm text-muted-foreground border-t">
                <p className="font-medium">Generation Details:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>3 SMS variations (160 char limit)</li>
                  <li>2 MMS variations (1,600 char limit)</li>
                  <li>Generated by Claude & GPT-5</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Progress Bar for SMS Generation */}
          {generateMutation.isPending && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Generating SMS variations...</span>
                  <span className="text-muted-foreground">{Math.round(smsProgress)}%</span>
                </div>
                <Progress value={smsProgress} className="w-full" data-testid="progress-sms" />
              </CardContent>
            </Card>
          )}

          {/* Claude Variations */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">Claude Sonnet 4</h2>
                <Badge variant="outline" data-testid="badge-claude-count">
                  {claudeVariations.length} variations
                </Badge>
              </div>
            </div>

            {claudeError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{claudeError}</AlertDescription>
              </Alert>
            )}

            {claudeVariations.length === 0 && !generateMutation.isPending && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No Claude SMS variations generated yet</p>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 gap-4">
              {claudeVariations.map((variation, index) => (
                <SmsVariationCard
                  key={`claude-${index}`}
                  variation={variation}
                  index={index}
                  provider="claude"
                />
              ))}
            </div>
          </div>

          {/* GPT Variations */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">GPT-5 (ChatGPT 4o)</h2>
                <Badge variant="outline" data-testid="badge-gpt-count">
                  {gptVariations.length} variations
                </Badge>
              </div>
            </div>

            {gptError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{gptError}</AlertDescription>
              </Alert>
            )}

            {gptVariations.length === 0 && !generateMutation.isPending && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No GPT SMS variations generated yet</p>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 gap-4">
              {gptVariations.map((variation, index) => (
                <SmsVariationCard
                  key={`gpt-${index}`}
                  variation={variation}
                  index={index}
                  provider="gpt"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
