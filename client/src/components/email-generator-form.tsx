import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sparkles, Check, ChevronsUpDown, Trophy, TrendingUp, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Convert plain text body with HTML tags to proper HTML format
function convertBodyToHtml(body: string): string {
  // Split by triple line breaks (paragraph separators)
  const paragraphs = body.split('\n\n\n').filter(p => p.trim());
  
  // Wrap each paragraph in <p> tags with styling, and convert internal newlines to <br>
  return paragraphs
    .map(p => `<p style='margin:0 0 16px; line-height:1.6;'>${p.trim().replace(/\n/g, '<br>')}</p>`)
    .join('');
}

interface EmailGeneratorFormProps {
  products?: Array<{ id: string; name: string; offerType: string }>;
  onGenerate?: (config: GenerateConfig) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  initialProductId?: string;
  initialToneAngle?: string;
  initialCustomTone?: string;
  reuseMode?: boolean;
  originalEmail?: {
    subjects?: string[];
    subject?: string;
    body?: string;
  };
}

export interface GenerateConfig {
  productId: string;
  toneAngle: string;
  customTone?: string;
}

const toneAngles = [
  { value: "ai-enhanced", label: "AI Enhanced (learns from winners & losers)" },
  { value: "legendary-copywriters", label: "Legendary Copywriters (proven performance)" },
  { value: "you-won", label: '"You Won!" Angle (proven performance)' },
  { value: "high-performing", label: "High-Performing Direct Response" },
  { value: "current-events", label: "Current Events/Trending Styles" },
  { value: "try-something-new", label: "Try Something New" },
  { value: "review-based", label: "Review Based (Social Proof)" },
  { value: "story-time", label: "Story-Time (narrative)" },
  { value: "custom", label: "Custom Tone (your own prompt)" },
];

export function EmailGeneratorForm({
  products = [],
  onGenerate,
  onCancel,
  isLoading,
  initialProductId = "",
  initialToneAngle = "",
  initialCustomTone = "",
  reuseMode = false,
  originalEmail,
}: EmailGeneratorFormProps) {
  const [selectedProduct, setSelectedProduct] = useState<string>(initialProductId);
  const [selectedToneAngle, setSelectedToneAngle] = useState(initialToneAngle);
  const [customTone, setCustomTone] = useState(initialCustomTone);
  const [productComboboxOpen, setProductComboboxOpen] = useState(false);

  // Get the selected product's offer type
  const selectedProductData = products.find(p => p.id === selectedProduct);
  const selectedOfferType = selectedProductData?.offerType;

  // Fetch offer-type-specific analytics for tone performance indicators
  const { data: analyticsResponse } = useQuery<{ success: boolean; analytics: any }>({
    queryKey: ['/api/analytics/offer-type', selectedOfferType],
    enabled: !!selectedOfferType, // Only fetch when we have an offer type
    staleTime: 30000, // Cache for 30 seconds
  });

  const analytics = analyticsResponse?.analytics;
  const toneStats = analytics?.byTone || {};
  const topPerformerTone = analytics?.topPerformer?.tone;

  // Sync state when initial props change (for reuse functionality)
  useEffect(() => {
    if (initialProductId) {
      setSelectedProduct(initialProductId);
    }
  }, [initialProductId]);

  useEffect(() => {
    if (initialToneAngle) {
      setSelectedToneAngle(initialToneAngle);
    }
  }, [initialToneAngle]);

  useEffect(() => {
    if (initialCustomTone) {
      setCustomTone(initialCustomTone);
    }
  }, [initialCustomTone]);

  const handleGenerate = () => {
    if (!selectedProduct) return;
    
    // In reuse mode, we don't need tone/angle
    if (!reuseMode) {
      if (!selectedToneAngle) return;
      if (selectedToneAngle === "custom" && !customTone.trim()) return;
    }
    
    onGenerate?.({
      productId: selectedProduct,
      toneAngle: selectedToneAngle,
      customTone: selectedToneAngle === "custom" ? customTone : undefined,
    });
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="gap-1 space-y-0 pb-4">
        <CardTitle className="text-xl">{reuseMode ? "Adapt Creative" : "Configure Email Set"}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {reuseMode 
            ? "Select a product - AI will adapt the creative for that product" 
            : "Select one product and tone - AI will generate 5 variations"}
        </p>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-6 overflow-auto">
        <div className="space-y-2">
          <Label htmlFor="product-combobox">Select Product</Label>
          <Popover open={productComboboxOpen} onOpenChange={setProductComboboxOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={productComboboxOpen}
                className="w-full justify-between"
                id="product-combobox"
                data-testid="button-product-combobox"
              >
                {selectedProduct
                  ? products.find((product) => product.id === selectedProduct)?.name
                  : "Search products..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start">
              <Command>
                <CommandInput placeholder="Search products..." data-testid="input-product-search" />
                <CommandList>
                  <CommandEmpty>No products found.</CommandEmpty>
                  <CommandGroup>
                    {products.map((product) => (
                      <CommandItem
                        key={product.id}
                        value={product.name}
                        onSelect={() => {
                          setSelectedProduct(product.id);
                          setProductComboboxOpen(false);
                        }}
                        data-testid={`command-item-product-${product.id}`}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedProduct === product.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex-1">
                          <div className="font-medium">{product.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {product.offerType === "straight-sale" ? "Straight Sale" : "Free + Shipping"}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground">
            Search and select one product for email generation
          </p>
        </div>

        {reuseMode && originalEmail ? (
          <div className="space-y-2 flex-1 flex flex-col min-h-0">
            <Label>Original Creative Reference</Label>
            <Card className="bg-muted/30 flex-1 flex flex-col min-h-0">
              <CardContent className="p-4 space-y-3 flex-1 flex flex-col min-h-0">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Subject Lines:</p>
                  <div className="space-y-1">
                    {(originalEmail.subjects || [originalEmail.subject]).filter(Boolean).map((subject, idx) => (
                      <p key={idx} className="text-sm" data-testid={`text-original-subject-${idx}`}>
                        {subject}
                      </p>
                    ))}
                  </div>
                </div>
                <div className="flex-1 flex flex-col min-h-0">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Body:</p>
                  <div 
                    className="text-sm overflow-auto flex-1 border rounded-md p-4 bg-background/50" 
                    data-testid="text-original-body"
                    style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                  >
                    <div 
                      dangerouslySetInnerHTML={{ 
                        __html: convertBodyToHtml(originalEmail.body || '').replace(/<a /g, '<a style="color:#0066cc" ') 
                      }} 
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              AI will adapt this creative's style and structure for your selected product
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="tone-angle">
                Tone & Angle
                {analytics?.topPerformer && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    <Trophy className="h-3 w-3 inline text-chart-2 mb-0.5" /> Top performer highlighted
                  </span>
                )}
              </Label>
              <Select value={selectedToneAngle} onValueChange={setSelectedToneAngle}>
                <SelectTrigger id="tone-angle" data-testid="select-tone-angle">
                  <SelectValue placeholder="Select copywriting style..." />
                </SelectTrigger>
                <SelectContent>
                  {toneAngles.map((option) => {
                    const stats = toneStats[option.value];
                    const tested = stats ? stats.winners + stats.losers : 0;
                    const winRate = stats?.winRate || 0;
                    const isTopPerformer = option.value === topPerformerTone;

                    return (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center justify-between w-full gap-2">
                          <span>{option.label}</span>
                          {tested > 0 && (
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "ml-auto text-xs shrink-0",
                                isTopPerformer 
                                  ? "bg-chart-2/10 text-chart-2 border-chart-2/20" 
                                  : "bg-muted"
                              )}
                            >
                              {isTopPerformer && <Trophy className="h-3 w-3 mr-1 inline" />}
                              {winRate}%
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {analytics?.overall?.winners > 0 
                  ? `AI learns from ${analytics.overall.winners} ${selectedOfferType === 'free-shipping' ? 'F+S' : 'straight-sale'} winning emails • Win rates shown above` 
                  : selectedOfferType 
                    ? `No ${selectedOfferType === 'free-shipping' ? 'F+S' : 'straight-sale'} winners yet • AI uses global patterns`
                    : 'Length (50-200 words) and CTAs auto-determined by AI'}
              </p>
            </div>

            {selectedToneAngle === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="custom-tone">Custom Tone Instructions</Label>
                <Textarea
                  id="custom-tone"
                  value={customTone}
                  onChange={(e) => setCustomTone(e.target.value)}
                  placeholder="Describe the tone, style, and approach you want for your emails... (e.g., 'Write like a tech startup founder - casual, innovative, using emojis and short punchy sentences')"
                  className="min-h-[100px] resize-none"
                  data-testid="textarea-custom-tone"
                />
              </div>
            )}
          </>
        )}

        <div className="flex gap-2 mt-auto">
          <Button
            onClick={handleGenerate}
            disabled={
              isLoading || 
              !selectedProduct || 
              (!reuseMode && (!selectedToneAngle || (selectedToneAngle === "custom" && !customTone.trim())))
            }
            className="flex-1 h-12"
            data-testid="button-generate"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {isLoading 
              ? (reuseMode ? "Adapting Creative..." : "Generating 5 Emails...") 
              : (reuseMode ? "Adapt Creative for This Product" : "Generate 5 Email Variations")}
          </Button>
          
          {isLoading && onCancel && (
            <Button
              onClick={onCancel}
              variant="outline"
              className="h-12"
              data-testid="button-cancel"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
