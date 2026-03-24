import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Plus, Loader2, Folder, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface NamingCategory {
  id: string;
  name: string;
  displayName: string | null;
}

interface NamingProductId {
  id: string;
  name: string;
  displayName: string | null;
}

interface NamingType {
  id: string;
  name: string;
  displayName: string | null;
  categoryId: string;
}

interface MtpFolder {
  id: number;
  name: string;
  parentId: number | null;
  path: string;
}

interface StructuredFilenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (filename: string, folderId?: number) => void;
  isPending: boolean;
  title?: string;
  description?: string;
  progress?: { current: number; total: number };
}

function getDisplayLabel(item: { name: string; displayName?: string | null }): string {
  return item.displayName || item.name;
}

interface FolderTreeNode extends MtpFolder {
  depth: number;
}

function buildFolderTree(folders: MtpFolder[]): FolderTreeNode[] {
  const result: FolderTreeNode[] = [];
  const visited = new Set<number>();

  function addFolder(folder: MtpFolder, depth: number) {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    result.push({ ...folder, depth });
    folders
      .filter(f => f.parentId === folder.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(child => addFolder(child, depth + 1));
  }

  folders
    .filter(f => f.parentId === null)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(root => addFolder(root, 0));

  return result;
}

// Hardcoded preset categories with their abbreviations for the filename
const PRESET_CATEGORIES = [
  { id: "preset-product", name: "product", displayName: "Product", abbreviation: "pr" },
  { id: "preset-adcreative", name: "adcreative", displayName: "Ad Creative", abbreviation: "ad" },
  { id: "preset-lifestyle", name: "lifestyle", displayName: "Lifestyle", abbreviation: "lifestyle" },
  { id: "preset-element", name: "element", displayName: "Element", abbreviation: "el" },
];

// Hardcoded preset product/IDs by category
const PRESET_PRODUCT_IDS_BY_CATEGORY: Record<string, Array<{ id: string; name: string; displayName: string }>> = {
  "preset-product": [],
  "preset-adcreative": [
    { id: "preset-fb", name: "fb", displayName: "Facebook" },
    { id: "preset-yt", name: "yt", displayName: "YouTube" },
    { id: "preset-rum", name: "rum", displayName: "Rumble" },
  ],
  "preset-lifestyle": [],
  "preset-element": [],
};

// Hardcoded preset types by category
const PRESET_TYPES_BY_CATEGORY: Record<string, Array<{ id: string; name: string; displayName: string }>> = {
  "preset-product": [
    { id: "preset-product-null", name: "null", displayName: "Null" },
    { id: "preset-product-photo", name: "photo", displayName: "Photo" },
    { id: "preset-product-graphic", name: "graphic", displayName: "Graphic" },
    { id: "preset-product-mockup", name: "mockup", displayName: "Mockup" },
    { id: "preset-product-review", name: "review", displayName: "Review" },
  ],
  "preset-adcreative": [
    { id: "preset-ad-hero", name: "hero", displayName: "Hero" },
    { id: "preset-ad-variation", name: "variation", displayName: "Variation" },
    { id: "preset-ad-testimonial", name: "testimonial", displayName: "Testimonial" },
    { id: "preset-ad-comparison", name: "comparison", displayName: "Comparison" },
  ],
  "preset-lifestyle": [
    { id: "preset-lifestyle-null", name: "null", displayName: "Null" },
    { id: "preset-lifestyle-photo", name: "photo", displayName: "Photo" },
    { id: "preset-lifestyle-graphic", name: "graphic", displayName: "Graphic" },
    { id: "preset-lifestyle-mockup", name: "mockup", displayName: "Mockup" },
    { id: "preset-lifestyle-review", name: "review", displayName: "Review" },
  ],
  "preset-element": [
    { id: "preset-element-badge", name: "badge", displayName: "Badge" },
    { id: "preset-element-icon", name: "icon", displayName: "Icon" },
    { id: "preset-element-texture", name: "texture", displayName: "Texture" },
    { id: "preset-element-logo", name: "logo", displayName: "Logo" },
  ],
};

export default function StructuredFilenameDialog({
  open,
  onOpenChange,
  onSave,
  isPending,
  title = "Save to MTP-Images",
  description = "Choose naming convention components",
  progress
}: StructuredFilenameDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedType, setSelectedType] = useState<string>("");
  const [variant, setVariant] = useState<string>("");
  const [sequence, setSequence] = useState<string>("1");
  
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [productIdOpen, setProductIdOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newProductIdName, setNewProductIdName] = useState("");
  const [newTypeName, setNewTypeName] = useState("");
  
  const [selectedFolder, setSelectedFolder] = useState<number | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<number | null>(null);

  const { data: foldersData } = useQuery<{ success: boolean; folders: MtpFolder[] }>({
    queryKey: ['/api/mtp-folders'],
    enabled: open
  });

  const createFolderMutation = useMutation({
    mutationFn: async ({ name, parentId }: { name: string; parentId: number | null }) => {
      const response = await apiRequest('POST', '/api/mtp-folders', { name, parentId });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-folders'] });
      setSelectedFolder(data.folder?.id || null);
      setNewFolderName("");
      setShowCreateFolder(false);
    }
  });

  const folders = foldersData?.folders || [];
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const { data: categoriesData } = useQuery<{ success: boolean; categories: NamingCategory[] }>({
    queryKey: ['/api/mtp-naming/categories'],
    enabled: open
  });

  const { data: productIdsData } = useQuery<{ success: boolean; productIds: NamingProductId[] }>({
    queryKey: ['/api/mtp-naming/product-ids'],
    enabled: open
  });

  const typesQueryKey = selectedCategory ? `/api/mtp-naming/types?categoryId=${encodeURIComponent(selectedCategory)}` : '/api/mtp-naming/types';
  const { data: typesData } = useQuery<{ success: boolean; types: NamingType[] }>({
    queryKey: [typesQueryKey],
    enabled: open && !!selectedCategory && !selectedCategory.startsWith('preset-')
  });

  // Combine preset categories with database categories
  const categories = useMemo(() => {
    const dbCategories = categoriesData?.categories || [];
    const presetNames = PRESET_CATEGORIES.map(p => p.name);
    const filteredDbCategories = dbCategories.filter(c => !presetNames.includes(c.name));
    return [
      ...PRESET_CATEGORIES.map(p => ({ id: p.id, name: p.name, displayName: p.displayName })),
      ...filteredDbCategories
    ];
  }, [categoriesData?.categories]);

  // Get product IDs - combine preset and database entries for all categories
  // Product/ID is a global field that can be used with any category
  const productIds = useMemo(() => {
    if (!selectedCategory) return [];
    
    // Get preset product IDs for this category (if any)
    const presetIds = selectedCategory.startsWith('preset-') 
      ? (PRESET_PRODUCT_IDS_BY_CATEGORY[selectedCategory] || [])
      : [];
    
    // Get all database product IDs
    const dbIds = productIdsData?.productIds || [];
    
    // Combine both, avoiding duplicates by name
    const presetNames = new Set(presetIds.map(p => p.name.toLowerCase()));
    const filteredDbIds = dbIds.filter(p => !presetNames.has(p.name.toLowerCase()));
    
    return [...presetIds, ...filteredDbIds];
  }, [productIdsData?.productIds, selectedCategory]);

  // Get types based on selected category (preset or database)
  const types = useMemo(() => {
    if (!selectedCategory) return [];
    
    // Check if it's a preset category
    if (selectedCategory.startsWith('preset-')) {
      return PRESET_TYPES_BY_CATEGORY[selectedCategory] || [];
    }
    
    // Otherwise use database types filtered by category
    const allTypes = typesData?.types || [];
    return allTypes.filter(t => t.categoryId === selectedCategory);
  }, [typesData?.types, selectedCategory]);

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest('POST', '/api/mtp-naming/categories', { name });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to create category');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-naming/categories'] });
      if (data.category) {
        setSelectedCategory(data.category.id);
      }
      setNewCategoryName("");
      setCategoryOpen(false);
    },
    onError: (error) => {
      console.error('Failed to create category:', error);
    }
  });

  const createProductIdMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest('POST', '/api/mtp-naming/product-ids', { name });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to create product ID');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-naming/product-ids'] });
      if (data.productId) {
        setSelectedProductId(data.productId.id);
      }
      setNewProductIdName("");
      setProductIdOpen(false);
    },
    onError: (error) => {
      console.error('Failed to create product ID:', error);
    }
  });

  const createTypeMutation = useMutation({
    mutationFn: async ({ name, categoryId }: { name: string; categoryId: string }) => {
      const response = await apiRequest('POST', '/api/mtp-naming/types', { name, categoryId });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to create type');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [typesQueryKey] });
      if (data.type) {
        setSelectedType(data.type.id);
      }
      setNewTypeName("");
      setTypeOpen(false);
    },
    onError: (error) => {
      console.error('Failed to create type:', error);
    }
  });

  const getSelectedCategoryInfo = () => {
    const preset = PRESET_CATEGORIES.find(c => c.id === selectedCategory);
    if (preset) {
      return { name: preset.name, displayName: preset.displayName, prefix: preset.abbreviation };
    }
    const dbCategory = (categoriesData?.categories || []).find(c => c.id === selectedCategory);
    if (dbCategory) {
      return { name: dbCategory.name, displayName: dbCategory.displayName || dbCategory.name, prefix: dbCategory.name.replace(/-/g, '') };
    }
    return { name: "", displayName: "", prefix: "" };
  };

  const selectedCategoryInfo = getSelectedCategoryInfo();
  const selectedProductIdItem = productIds.find(p => p.id === selectedProductId);
  const selectedProductIdName = selectedProductIdItem?.name || "";
  const selectedTypeItem = types.find(t => t.id === selectedType);
  const selectedTypeName = selectedTypeItem?.name || "";

  // Build filename prefix using category abbreviation
  const filenamePrefix = useMemo(() => {
    const parts = [
      selectedCategoryInfo.prefix,
      selectedProductIdName.replace(/-/g, ''),
      selectedTypeName.replace(/-/g, ''),
      variant.toLowerCase().replace(/[^a-z0-9]/g, '')
    ].filter(Boolean);
    return parts.join('-');
  }, [selectedCategoryInfo.prefix, selectedProductIdName, selectedTypeName, variant]);

  const { data: sequenceData } = useQuery<{ success: boolean; nextSequence: number }>({
    queryKey: ['/api/mtp-naming/next-sequence', filenamePrefix],
    queryFn: async () => {
      if (!filenamePrefix) return { success: true, nextSequence: 1 };
      const response = await fetch(`/api/mtp-naming/next-sequence?prefix=${encodeURIComponent(filenamePrefix)}`);
      return response.json();
    },
    enabled: open && !!filenamePrefix
  });

  useEffect(() => {
    if (sequenceData?.nextSequence) {
      setSequence(String(sequenceData.nextSequence));
    }
  }, [sequenceData?.nextSequence]);

  const previewFilename = useMemo(() => {
    if (!filenamePrefix) return 'preview-filename';
    const paddedSequence = sequence.padStart(3, '0');
    return `${filenamePrefix}-${paddedSequence}`;
  }, [filenamePrefix, sequence]);

  // Product/ID is now optional - only category and type are required
  const isValid = selectedCategory && selectedType && sequence && parseInt(sequence) > 0;

  const handleSave = () => {
    if (isValid) {
      onSave(previewFilename, selectedFolder || undefined);
    }
  };

  useEffect(() => {
    if (!open) {
      setSelectedCategory("");
      setSelectedProductId("");
      setSelectedType("");
      setVariant("");
      setSequence("1");
      setSelectedFolder(null);
      setNewFolderName("");
      setShowCreateFolder(false);
    }
  }, [open]);

  useEffect(() => {
    if (selectedCategory) {
      setSelectedType("");
      setSelectedProductId("");
    }
  }, [selectedCategory]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Category *</Label>
            <Popover open={categoryOpen} onOpenChange={setCategoryOpen} modal={true}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={categoryOpen}
                  className="w-full justify-between"
                  data-testid="select-category"
                >
                  {selectedCategory
                    ? selectedCategoryInfo.displayName
                    : "Select category..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0 z-[100]" align="start">
                <Command>
                  <CommandInput placeholder="Search or add category..." value={newCategoryName} onValueChange={setNewCategoryName} />
                  <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>
                    <CommandGroup heading="Preset Categories">
                      {PRESET_CATEGORIES.map((category) => (
                        <CommandItem
                          key={category.id}
                          value={category.displayName}
                          onSelect={() => {
                            setSelectedCategory(category.id);
                            setCategoryOpen(false);
                            setNewCategoryName("");
                          }}
                          data-testid={`option-category-${category.name}`}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedCategory === category.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="flex-1">{category.displayName}</span>
                          <span className="text-xs text-muted-foreground ml-2">{category.abbreviation}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {(categoriesData?.categories || []).filter(c => !PRESET_CATEGORIES.some(p => p.name === c.name)).length > 0 && (
                      <CommandGroup heading="Custom Categories">
                        {(categoriesData?.categories || [])
                          .filter(c => !PRESET_CATEGORIES.some(p => p.name === c.name))
                          .map((category) => (
                            <CommandItem
                              key={category.id}
                              value={getDisplayLabel(category)}
                              onSelect={() => {
                                setSelectedCategory(category.id);
                                setCategoryOpen(false);
                                setNewCategoryName("");
                              }}
                              data-testid={`option-category-${category.name}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedCategory === category.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span className="flex-1">{getDisplayLabel(category)}</span>
                              <span className="text-xs text-muted-foreground ml-2">{category.name}</span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    )}
                    {newCategoryName && ![...PRESET_CATEGORIES.map(c => c.displayName), ...(categoriesData?.categories || []).map(c => getDisplayLabel(c))].some(label => label.toLowerCase() === newCategoryName.toLowerCase()) && (
                      <CommandGroup>
                        <CommandItem
                          value={`__add_category__${newCategoryName}`}
                          onSelect={() => { createCategoryMutation.mutate(newCategoryName); }}
                          data-testid="button-add-category"
                          disabled={createCategoryMutation.isPending}
                        >
                          {createCategoryMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          {createCategoryMutation.isPending ? "Adding..." : `Add "${newCategoryName}"`}
                        </CommandItem>
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Product/ID <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Popover open={productIdOpen} onOpenChange={setProductIdOpen} modal={true}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={productIdOpen}
                  className="w-full justify-between"
                  data-testid="select-product-id"
                >
                  {selectedProductId
                    ? getDisplayLabel(productIds.find(p => p.id === selectedProductId) || { name: "" })
                    : "Select product/ID..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0 z-[100]" align="start">
                <Command>
                  <CommandInput placeholder="Search or add product/ID..." value={newProductIdName} onValueChange={setNewProductIdName} />
                  <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>
                    {productIds.length > 0 ? (
                      <CommandGroup>
                        {productIds.map((productId) => (
                          <CommandItem
                            key={productId.id}
                            value={getDisplayLabel(productId)}
                            onSelect={() => {
                              setSelectedProductId(productId.id);
                              setProductIdOpen(false);
                              setNewProductIdName("");
                            }}
                            data-testid={`option-product-id-${productId.name}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedProductId === productId.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="flex-1">{getDisplayLabel(productId)}</span>
                            {productId.displayName && productId.displayName !== productId.name && (
                              <span className="text-xs text-muted-foreground ml-2">{productId.name}</span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : (
                      <CommandGroup>
                        <p className="p-2 text-sm text-muted-foreground">
                          {selectedCategory ? "No preset options for this category. Type to add a custom Product/ID." : "Select a category first"}
                        </p>
                      </CommandGroup>
                    )}
                    {newProductIdName && !productIds.some(p => getDisplayLabel(p).toLowerCase() === newProductIdName.toLowerCase()) && (
                      <CommandGroup>
                        <CommandItem
                          value={`__add_product__${newProductIdName}`}
                          onSelect={() => { createProductIdMutation.mutate(newProductIdName); }}
                          data-testid="button-add-product-id"
                          disabled={createProductIdMutation.isPending}
                        >
                          {createProductIdMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          {createProductIdMutation.isPending ? "Adding..." : `Add "${newProductIdName}"`}
                        </CommandItem>
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selectedProductId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={() => setSelectedProductId("")}
              >
                Clear selection
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label>Type * {!selectedCategory && <span className="text-xs text-muted-foreground">(select category first)</span>}</Label>
            <Popover open={typeOpen} onOpenChange={setTypeOpen} modal={true}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={typeOpen}
                  className="w-full justify-between"
                  disabled={!selectedCategory}
                  data-testid="select-type"
                >
                  {selectedType
                    ? getDisplayLabel(types.find(t => t.id === selectedType) || { name: "" })
                    : "Select type..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0 z-[100]" align="start">
                <Command>
                  <CommandInput placeholder="Search or add type..." value={newTypeName} onValueChange={setNewTypeName} />
                  <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>
                    <CommandGroup>
                      {types.map((type) => (
                        <CommandItem
                          key={type.id}
                          value={getDisplayLabel(type)}
                          onSelect={() => {
                            setSelectedType(type.id);
                            setTypeOpen(false);
                            setNewTypeName("");
                          }}
                          data-testid={`option-type-${type.name}`}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedType === type.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="flex-1">{getDisplayLabel(type)}</span>
                          {type.displayName && type.displayName !== type.name && (
                            <span className="text-xs text-muted-foreground ml-2">{type.name}</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {newTypeName && selectedCategory && !selectedCategory.startsWith('preset-') && !types.some(t => getDisplayLabel(t).toLowerCase() === newTypeName.toLowerCase()) && (
                      <CommandGroup>
                        <CommandItem
                          value={`__add_type__${newTypeName}`}
                          onSelect={() => { createTypeMutation.mutate({ name: newTypeName, categoryId: selectedCategory }); }}
                          data-testid="button-add-type"
                          disabled={createTypeMutation.isPending}
                        >
                          {createTypeMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          {createTypeMutation.isPending ? "Adding..." : `Add "${newTypeName}"`}
                        </CommandItem>
                      </CommandGroup>
                    )}
                    {newTypeName && selectedCategory?.startsWith('preset-') && !types.some(t => getDisplayLabel(t).toLowerCase() === newTypeName.toLowerCase()) && (
                      <CommandGroup>
                        <p className="p-2 text-sm text-muted-foreground">
                          Custom types can only be added to custom categories
                        </p>
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="variant">Variant <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Input
              id="variant"
              value={variant}
              onChange={(e) => setVariant(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              placeholder="e.g., blue, v2"
              data-testid="input-variant"
            />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Folder className="h-4 w-4" />
              Folder (optional)
            </Label>
            {!showCreateFolder ? (
              <div className="flex gap-2">
                <Popover open={folderOpen} onOpenChange={setFolderOpen} modal={true}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={folderOpen}
                      className="flex-1 justify-between"
                      data-testid="select-folder"
                    >
                      {selectedFolder
                        ? folders.find(f => f.id === selectedFolder)?.path || folders.find(f => f.id === selectedFolder)?.name || "Selected folder"
                        : "Root (no folder)"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0 z-[100]" align="start">
                    <Command>
                      <CommandInput placeholder="Search folders..." />
                      <CommandList>
                        <CommandEmpty>No folders found</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="root"
                            onSelect={() => {
                              setSelectedFolder(null);
                              setFolderOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedFolder === null ? "opacity-100" : "opacity-0"
                              )}
                            />
                            Root (no folder)
                          </CommandItem>
                          {folderTree.map((folder) => (
                            <CommandItem
                              key={folder.id}
                              value={folder.path || folder.name}
                              onSelect={() => {
                                setSelectedFolder(folder.id);
                                setFolderOpen(false);
                              }}
                              style={{ paddingLeft: `${8 + folder.depth * 16}px` }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4 shrink-0",
                                  selectedFolder === folder.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <Folder className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                              {folder.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowCreateFolder(true)}
                  data-testid="button-create-folder"
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2 border rounded-md p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Create New Folder</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowCreateFolder(false);
                      setNewFolderName("");
                      setNewFolderParent(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                <Input
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  data-testid="input-new-folder-name"
                />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Parent folder (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        {newFolderParent
                          ? folders.find(f => f.id === newFolderParent)?.name || "Selected"
                          : "Root"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[250px] p-0" align="start">
                      <Command>
                        <CommandList>
                          <CommandGroup>
                            <CommandItem onSelect={() => setNewFolderParent(null)}>
                              <Check className={cn("mr-2 h-4 w-4", newFolderParent === null ? "opacity-100" : "opacity-0")} />
                              Root
                            </CommandItem>
                            {folderTree.map((folder) => (
                              <CommandItem
                                key={folder.id}
                                onSelect={() => setNewFolderParent(folder.id)}
                                style={{ paddingLeft: `${8 + folder.depth * 16}px` }}
                              >
                                <Check className={cn("mr-2 h-4 w-4 shrink-0", newFolderParent === folder.id ? "opacity-100" : "opacity-0")} />
                                <Folder className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                                {folder.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <Button
                  className="w-full"
                  disabled={!newFolderName.trim() || createFolderMutation.isPending}
                  onClick={() => createFolderMutation.mutate({ name: newFolderName.trim(), parentId: newFolderParent })}
                  data-testid="button-confirm-create-folder"
                >
                  {createFolderMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <FolderPlus className="h-4 w-4 mr-2" />
                      Create Folder
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-md bg-muted p-3">
            <Label className="text-xs text-muted-foreground">Preview filename:</Label>
            <p className="font-mono text-sm mt-1" data-testid="text-filename-preview">
              {selectedFolder ? `${folders.find(f => f.id === selectedFolder)?.path || folders.find(f => f.id === selectedFolder)?.name}/` : ""}{previewFilename}.png
            </p>
          </div>
        </div>

        {/* Progress display for batch saves */}
        {isPending && progress && progress.total > 1 && (
          <div className="space-y-2 py-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Saving images...</span>
              <span className="font-medium">{progress.current} / {progress.total}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!isValid || isPending}
            data-testid="button-save"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {progress && progress.total > 1 ? `Saving ${progress.current}/${progress.total}...` : "Saving..."}
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
