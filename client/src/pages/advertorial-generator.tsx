import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Loader2, FileText, Check, ChevronsUpDown, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Progress } from "@/components/ui/progress";
import type { Product } from "@shared/schema";

interface Angle {
  headline: string;
  overview: string;
}

interface GeneratedArticle {
  angle: Angle;
  articles: {
    gptV1: string;
    gptV2: string;
    claudeV1: string;
    claudeV2: string;
  };
}

export default function AdvertorialGenerator() {
  const { toast } = useToast();
  const anglesAbortControllerRef = useRef<AbortController | null>(null);
  const articlesAbortControllerRef = useRef<AbortController | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [salesPageLink, setSalesPageLink] = useState<string>("");
  const [generatedAngles, setGeneratedAngles] = useState<Angle[]>([]);
  const [selectedAngles, setSelectedAngles] = useState<Set<number>>(new Set());
  const [generatedArticles, setGeneratedArticles] = useState<GeneratedArticle[]>([]);
  const [openCards, setOpenCards] = useState<Set<number>>(new Set());
  const [anglesProgress, setAnglesProgress] = useState<number>(0);
  const [articlesProgress, setArticlesProgress] = useState<number>(0);

  // Fetch products from API
  const { data: productsData } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ["/api/products"],
  });

  const products = productsData?.products || [];

  // Find the selected product
  const selectedProduct = products.find(p => p.id === selectedProductId);

  // Load persisted state from localStorage on mount
  useEffect(() => {
    const loadPersistedState = () => {
      try {
        const saved = localStorage.getItem('advertorialGeneratorState');
        if (saved) {
          const state = JSON.parse(saved);
          setSelectedProductId(state.selectedProductId || "");
          setSalesPageLink(state.salesPageLink || "");
          setGeneratedAngles(state.generatedAngles || []);
          setSelectedAngles(new Set(state.selectedAngles || []));
          setGeneratedArticles(state.generatedArticles || []);
          setOpenCards(new Set(state.openCards || []));
        }
      } catch (error) {
        console.error("Failed to load persisted advertorial generator state:", error);
      }
    };
    
    loadPersistedState();
  }, []);

  // Persist state to localStorage whenever it changes
  useEffect(() => {
    try {
      const state = {
        selectedProductId,
        salesPageLink,
        generatedAngles,
        selectedAngles: Array.from(selectedAngles),
        generatedArticles,
        openCards: Array.from(openCards),
      };
      localStorage.setItem('advertorialGeneratorState', JSON.stringify(state));
    } catch (error) {
      console.error("Failed to persist advertorial generator state:", error);
    }
  }, [selectedProductId, salesPageLink, generatedAngles, selectedAngles, generatedArticles, openCards]);

  // Mutation to generate angles
  const generateAnglesMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProductId || !salesPageLink) {
        throw new Error("Please select a product and enter a sales page link");
      }

      const product = products.find(p => p.id === selectedProductId);
      if (!product) {
        throw new Error("Product not found");
      }

      // Defensive abort of any pending request
      anglesAbortControllerRef.current?.abort();
      anglesAbortControllerRef.current = new AbortController();

      const response = await fetch("/api/generate-advertorial-angles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productName: product.displayName || product.name,
          salesPageLink,
        }),
        signal: anglesAbortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to generate angles" }));
        throw new Error(errorData.error || "Failed to generate angles");
      }
      
      return await response.json();
    },
    onSuccess: (data: any) => {
      setGeneratedAngles(data.angles || []);
      setSelectedAngles(new Set());
      setGeneratedArticles([]);
      toast({
        title: "Angles Generated",
        description: `Generated ${data.angles?.length || 0} advertorial angles`,
      });
    },
    onError: (error: any) => {
      if (error?.name === 'AbortError') {
        toast({
          title: "Generation Cancelled",
          description: "Angle generation was cancelled successfully",
        });
      } else {
        toast({
          title: "Generation Failed",
          description: error instanceof Error ? error.message : "Failed to generate angles",
          variant: "destructive",
        });
      }
    },
    onSettled: () => {
      anglesAbortControllerRef.current = null;
    },
  });
  
  // Handle cancel angles generation
  const handleCancelAnglesGeneration = () => {
    if (anglesAbortControllerRef.current) {
      anglesAbortControllerRef.current.abort();
      setAnglesProgress(0);
    }
  };

  // Mutation to generate full articles
  const generateArticlesMutation = useMutation({
    mutationFn: async () => {
      if (selectedAngles.size === 0) {
        throw new Error("Please select at least one angle");
      }

      const product = products.find(p => p.id === selectedProductId);
      if (!product) {
        throw new Error("Product not found");
      }

      const anglesToGenerate = Array.from(selectedAngles).map(index => generatedAngles[index]);

      // Defensive abort of any pending request
      articlesAbortControllerRef.current?.abort();
      articlesAbortControllerRef.current = new AbortController();

      const response = await fetch("/api/generate-advertorial-articles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productName: product.displayName || product.name,
          salesPageLink,
          angles: anglesToGenerate,
        }),
        signal: articlesAbortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to generate articles" }));
        throw new Error(errorData.error || "Failed to generate articles");
      }
      
      return await response.json();
    },
    onSuccess: (data: any) => {
      setGeneratedArticles(data.articles || []);
      setOpenCards(new Set()); // Close all cards initially
      toast({
        title: "Articles Generated",
        description: `Generated ${data.articles?.length || 0} full advertorial articles`,
      });
    },
    onError: (error: any) => {
      if (error?.name === 'AbortError') {
        toast({
          title: "Generation Cancelled",
          description: "Article generation was cancelled successfully",
        });
      } else {
        toast({
          title: "Generation Failed",
          description: error instanceof Error ? error.message : "Failed to generate articles",
          variant: "destructive",
        });
      }
    },
    onSettled: () => {
      articlesAbortControllerRef.current = null;
    },
  });
  
  // Handle cancel articles generation
  const handleCancelArticlesGeneration = () => {
    if (articlesAbortControllerRef.current) {
      articlesAbortControllerRef.current.abort();
      setArticlesProgress(0);
    }
  };

  // Smooth progress animation for angle generation
  useEffect(() => {
    if (generateAnglesMutation.isPending) {
      setAnglesProgress(0);
      const duration = 15000; // 15 seconds
      const interval = 50; // Update every 50ms
      const increment = (100 / duration) * interval;
      
      const timer = setInterval(() => {
        setAnglesProgress(prev => {
          const next = prev + increment;
          if (next >= 95) {
            clearInterval(timer);
            return 95; // Stop at 95% until actual completion
          }
          return next;
        });
      }, interval);

      return () => clearInterval(timer);
    } else {
      // Complete to 100% when done
      if (anglesProgress > 0) {
        setAnglesProgress(100);
        setTimeout(() => setAnglesProgress(0), 500);
      }
    }
  }, [generateAnglesMutation.isPending, anglesProgress]);

  // Smooth progress animation for article generation
  useEffect(() => {
    if (generateArticlesMutation.isPending) {
      setArticlesProgress(0);
      const duration = 20000; // 20 seconds (articles take longer)
      const interval = 50;
      const increment = (100 / duration) * interval;
      
      const timer = setInterval(() => {
        setArticlesProgress(prev => {
          const next = prev + increment;
          if (next >= 95) {
            clearInterval(timer);
            return 95;
          }
          return next;
        });
      }, interval);

      return () => clearInterval(timer);
    } else {
      if (articlesProgress > 0) {
        setArticlesProgress(100);
        setTimeout(() => setArticlesProgress(0), 500);
      }
    }
  }, [generateArticlesMutation.isPending, articlesProgress]);

  const handleAngleToggle = (index: number) => {
    const newSelected = new Set(selectedAngles);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedAngles(newSelected);
  };

  const toggleCard = (index: number) => {
    const newOpen = new Set(openCards);
    if (newOpen.has(index)) {
      newOpen.delete(index);
    } else {
      newOpen.add(index);
    }
    setOpenCards(newOpen);
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Advertorial Generator</h1>
        <p className="text-muted-foreground">
          Generate compelling advertorial angles and full-length editorial-style articles
        </p>
      </div>

      {/* Configuration Section */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Product Selection */}
          <div className="space-y-2">
            <Label htmlFor="product-select">Product</Label>
            <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={productSearchOpen}
                  className="w-full justify-between"
                  id="product-select"
                  data-testid="select-product"
                >
                  {selectedProductId 
                    ? products.find((product) => product.id === selectedProductId)?.displayName || 
                      products.find((product) => product.id === selectedProductId)?.name || "Select a product..." 
                    : "Select a product..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0">
                <Command>
                  <CommandInput placeholder="Search products..." data-testid="input-search-product" />
                  <CommandList>
                    <CommandEmpty>No product found.</CommandEmpty>
                    <CommandGroup>
                      {products.map((product) => (
                        <CommandItem
                          key={product.id}
                          value={product.displayName || product.name}
                          onSelect={() => {
                            setSelectedProductId(product.id);
                            setProductSearchOpen(false);
                          }}
                          data-testid={`option-product-${product.id}`}
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

          {/* Sales Page Link */}
          <div className="space-y-2">
            <Label htmlFor="sales-link">Sales Page/Offer Link (NO PRELANDERS)</Label>
            <Input
              id="sales-link"
              data-testid="input-sales-link"
              type="url"
              placeholder="https://example.com/sales-page"
              value={salesPageLink}
              onChange={(e) => setSalesPageLink(e.target.value)}
            />
          </div>

          {/* Generate Angles / Cancel Button */}
          {generateAnglesMutation.isPending ? (
            <Button
              onClick={handleCancelAnglesGeneration}
              variant="destructive"
              className="w-full"
              data-testid="button-cancel-angles"
            >
              <X className="mr-2 h-4 w-4" />
              Cancel Angle Generation
            </Button>
          ) : (
            <Button
              data-testid="button-generate-angles"
              onClick={() => generateAnglesMutation.mutate()}
              disabled={!selectedProductId || !salesPageLink}
              className="w-full"
            >
              <FileText className="mr-2 h-4 w-4" />
              Generate 10 Advertorial Angles
            </Button>
          )}

          {/* Progress Bar for Angle Generation */}
          {generateAnglesMutation.isPending && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Generating advertorial angles...</span>
                <span className="text-muted-foreground">{Math.round(anglesProgress)}%</span>
              </div>
              <Progress value={anglesProgress} className="w-full" data-testid="progress-angles" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generated Angles Section */}
      {generatedAngles.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Generated Angles</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select the angles you want to develop into full articles
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {generatedAngles.map((angle, index) => (
              <div
                key={index}
                className="flex items-start space-x-3 p-4 rounded-md border hover-elevate"
                data-testid={`angle-${index}`}
              >
                <Checkbox
                  id={`angle-${index}`}
                  checked={selectedAngles.has(index)}
                  onCheckedChange={() => handleAngleToggle(index)}
                  data-testid={`checkbox-angle-${index}`}
                />
                <div className="flex-1">
                  <label
                    htmlFor={`angle-${index}`}
                    className="font-semibold cursor-pointer"
                  >
                    {angle.headline}
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {angle.overview}
                  </p>
                </div>
              </div>
            ))}

            {/* Generate Articles / Cancel Button */}
            {selectedAngles.size > 0 && (
              <>
                {generateArticlesMutation.isPending ? (
                  <Button
                    onClick={handleCancelArticlesGeneration}
                    variant="destructive"
                    className="w-full"
                    data-testid="button-cancel-articles"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel Article Generation
                  </Button>
                ) : (
                  <Button
                    data-testid="button-generate-articles"
                    onClick={() => generateArticlesMutation.mutate()}
                    className="w-full"
                  >
                    Generate {selectedAngles.size} Selected Article{selectedAngles.size > 1 ? 's' : ''}
                  </Button>
                )}

                {/* Progress Bar for Article Generation */}
                {generateArticlesMutation.isPending && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Generating full articles with 4 variations each...</span>
                      <span className="text-muted-foreground">{Math.round(articlesProgress)}%</span>
                    </div>
                    <Progress value={articlesProgress} className="w-full" data-testid="progress-articles" />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Generated Articles Section */}
      {generatedArticles.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Generated Articles</h2>
          <p className="text-muted-foreground mb-4">
            Click on each card to view the 4 article variations
          </p>

          {generatedArticles.map((articleSet, index) => {
            const isOpen = openCards.has(index);
            return (
              <Collapsible
                key={index}
                open={isOpen}
                onOpenChange={() => toggleCard(index)}
              >
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover-elevate" data-testid={`card-article-${index}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg">
                            {articleSet.angle.headline}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            {articleSet.angle.overview}
                          </p>
                        </div>
                        {isOpen ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent>
                      <Tabs defaultValue="gpt-v1" className="w-full">
                        <TabsList className="grid grid-cols-4 w-full">
                          <TabsTrigger value="gpt-v1" data-testid={`tab-gpt-v1-${index}`}>
                            ChatGPT v1
                          </TabsTrigger>
                          <TabsTrigger value="gpt-v2" data-testid={`tab-gpt-v2-${index}`}>
                            ChatGPT v2
                          </TabsTrigger>
                          <TabsTrigger value="claude-v1" data-testid={`tab-claude-v1-${index}`}>
                            Claude v1
                          </TabsTrigger>
                          <TabsTrigger value="claude-v2" data-testid={`tab-claude-v2-${index}`}>
                            Claude v2
                          </TabsTrigger>
                        </TabsList>

                        <TabsContent value="gpt-v1" className="mt-4">
                          <div 
                            className="prose max-w-none" 
                            data-testid={`article-gpt-v1-${index}`}
                            dangerouslySetInnerHTML={{ __html: articleSet.articles.gptV1 }}
                          />
                        </TabsContent>

                        <TabsContent value="gpt-v2" className="mt-4">
                          <div 
                            className="prose max-w-none" 
                            data-testid={`article-gpt-v2-${index}`}
                            dangerouslySetInnerHTML={{ __html: articleSet.articles.gptV2 }}
                          />
                        </TabsContent>

                        <TabsContent value="claude-v1" className="mt-4">
                          <div 
                            className="prose max-w-none" 
                            data-testid={`article-claude-v1-${index}`}
                            dangerouslySetInnerHTML={{ __html: articleSet.articles.claudeV1 }}
                          />
                        </TabsContent>

                        <TabsContent value="claude-v2" className="mt-4">
                          <div 
                            className="prose max-w-none" 
                            data-testid={`article-claude-v2-${index}`}
                            dangerouslySetInnerHTML={{ __html: articleSet.articles.claudeV2 }}
                          />
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}
