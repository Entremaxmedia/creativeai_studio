import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Loader2, Search, X, LayoutGrid, List, Edit, Trash2, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { ProductFormModal, type ProductFormData } from "@/components/product-form-modal";
import { ProductDetailsDialog } from "@/components/product-details-dialog";
import { EmailViewDialog } from "@/components/email-view-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Email, Product } from "@shared/schema";

type ViewMode = 'card' | 'list';

const ITEMS_PER_PAGE = 30;

export default function ProductsPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [viewEmail, setViewEmail] = useState<Email | null>(null);
  const [viewEmailDialogOpen, setViewEmailDialogOpen] = useState(false);
  
  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  
  // Search and filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [offerTypeFilter, setOfferTypeFilter] = useState<string>("all");
  
  // Reset to page 1 when search or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, offerTypeFilter]);
  
  // Build query params for pagination
  const queryParams = new URLSearchParams({
    page: currentPage.toString(),
    limit: ITEMS_PER_PAGE.toString(),
  });
  
  if (searchQuery.trim()) {
    queryParams.set('search', searchQuery.trim());
  }
  
  if (offerTypeFilter !== "all") {
    queryParams.set('offerType', offerTypeFilter);
  }
  
  // Fetch paginated products from API
  const { data: paginatedData, isLoading } = useQuery<{ 
    success: boolean; 
    items: Product[];
    total: number;
    totalPages: number;
    currentPage: number;
  }>({
    queryKey: ["/api/products", currentPage, ITEMS_PER_PAGE, searchQuery.trim(), offerTypeFilter],
    queryFn: async () => {
      const response = await fetch(`/api/products?${queryParams.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch products');
      return response.json();
    },
  });

  const products = paginatedData?.items || [];
  const total = paginatedData?.total || 0;
  const totalPages = paginatedData?.totalPages || 1;
  
  // Fetch all products for offer type filter options (non-paginated)
  const { data: allProductsData } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ["/api/products"],
  });
  
  // Get unique offer types for filter
  const offerTypes = useMemo(() => {
    const allProducts = allProductsData?.products || [];
    const types = new Set(allProducts.map(p => p.offerType));
    return Array.from(types).sort();
  }, [allProductsData]);
  
  const handleClearFilters = () => {
    setSearchQuery("");
    setOfferTypeFilter("all");
    setCurrentPage(1);
  };
  
  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      // Scroll to top of page
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Create product mutation
  const createProductMutation = useMutation({
    mutationFn: async (data: ProductFormData) => {
      const res = await apiRequest("POST", "/api/products", data);
      return await res.json();
    },
    onSuccess: () => {
      // Invalidate all product queries to refresh both paginated and non-paginated data
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Success",
        description: "Product created successfully",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create product",
      });
    },
  });

  // Update product mutation
  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ProductFormData }) => {
      const res = await apiRequest("PATCH", `/api/products/${id}`, data);
      return await res.json();
    },
    onSuccess: () => {
      // Invalidate all product queries to refresh both paginated and non-paginated data
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Success",
        description: "Product updated successfully",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update product",
      });
    },
  });

  // Delete product mutation
  const deleteProductMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/products/${id}`);
      return await res.json();
    },
    onSuccess: () => {
      // Invalidate all product queries to refresh both paginated and non-paginated data
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Success",
        description: "Product deleted successfully",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete product",
      });
    },
  });

  const handleAddProduct = (data: ProductFormData) => {
    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data });
      setEditingProduct(null);
    } else {
      createProductMutation.mutate(data);
    }
  };

  const handleEditProduct = async (id: string) => {
    // Fetch the product from the API to ensure we have the latest data
    const product = products.find((p) => p.id === id);
    if (product) {
      setEditingProduct(product);
      setShowModal(true);
    }
  };

  const handleDeleteProduct = (id: string) => {
    if (confirm("Are you sure you want to delete this product?")) {
      deleteProductMutation.mutate(id);
    }
  };

  const handleCloseModal = (open: boolean) => {
    setShowModal(open);
    if (!open) {
      setEditingProduct(null);
    }
  };

  const handleOpenProduct = (id: string) => {
    const product = products.find((p) => p.id === id);
    if (product) {
      setSelectedProduct(product);
      setDetailsDialogOpen(true);
    }
  };

  const handleEmailView = (email: Email) => {
    setViewEmail(email);
    setViewEmailDialogOpen(true);
  };

  const handleEmailDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this email?")) {
      try {
        const response = await apiRequest("DELETE", `/api/emails/${id}`);
        const result = await response.json();
        
        if (result.success) {
          toast({
            title: "Success",
            description: "Email deleted successfully",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
        } else {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to delete email",
          });
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "An error occurred while deleting the email",
        });
      }
    }
  };

  const handleEmailReuse = (id: string) => {
    setDetailsDialogOpen(false);
    setLocation(`/?reuse=${id}`);
  };

  const handleEmailStatusChange = async (id: string, status: string) => {
    try {
      const response = await apiRequest("PATCH", `/api/emails/${id}`, { status });
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Success",
          description: "Email status updated",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to update email status",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "An error occurred while updating the email status",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Products</h1>
            <p className="text-muted-foreground mt-1">
              Manage your product catalog - AI will audit offers automatically
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Products</h1>
          <p className="text-muted-foreground mt-1">
            Manage your product catalog - AI will audit offers automatically
          </p>
        </div>
        <Button onClick={() => setShowModal(true)} data-testid="button-add-product">
          <Plus className="h-4 w-4 mr-2" />
          Add Product
        </Button>
      </div>

      {/* Search and Filter Section */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search products by name, display name, or offer type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-products"
          />
        </div>
        
        <div className="flex gap-2">
          <Select value={offerTypeFilter} onValueChange={setOfferTypeFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-offer-type">
              <SelectValue placeholder="Filter by offer type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Offer Types</SelectItem>
              {offerTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {(searchQuery || offerTypeFilter !== "all") && (
            <Button
              variant="outline"
              onClick={handleClearFilters}
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Results count and view toggle */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" data-testid="text-results-count">
          Showing {products.length > 0 ? ((currentPage - 1) * ITEMS_PER_PAGE + 1) : 0}-{Math.min(currentPage * ITEMS_PER_PAGE, total)} of {total} products
        </p>
        
        {/* View Toggle */}
        <div className="flex gap-1 border rounded-md p-1">
          <Button
            variant={viewMode === 'card' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('card')}
            data-testid="button-view-card"
            className="gap-2"
          >
            <LayoutGrid className="h-4 w-4" />
            Cards
          </Button>
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            data-testid="button-view-list"
            className="gap-2"
          >
            <List className="h-4 w-4" />
            List
          </Button>
        </div>
      </div>

      {/* Card View */}
      {viewMode === 'card' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {products.length > 0 ? (
            products.map((product) => (
              <ProductCard
                key={product.id}
                {...product}
                onEdit={handleEditProduct}
                onDelete={handleDeleteProduct}
                onSelect={(id) => console.log("Select product:", id)}
                onOpen={handleOpenProduct}
              />
            ))
          ) : (
            <div className="col-span-full text-center py-12">
              <p className="text-muted-foreground" data-testid="text-no-results">
                {searchQuery || offerTypeFilter !== "all" 
                  ? "No products match your search criteria" 
                  : "No products yet"}
              </p>
            </div>
          )}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="border rounded-md">
          {products.length > 0 ? (
            <div className="divide-y">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center gap-4 p-4 hover-elevate"
                  data-testid={`list-item-product-${product.id}`}
                >
                  {/* Product Image */}
                  <div className="w-16 h-16 flex-shrink-0">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        loading="lazy"
                        className="w-full h-full object-cover rounded-md"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted rounded-md flex items-center justify-center text-muted-foreground text-xs">
                        No image
                      </div>
                    )}
                  </div>

                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm truncate">
                          {product.displayName || product.name}
                        </h3>
                        {product.displayName && (
                          <p className="text-xs text-muted-foreground truncate">
                            {product.name}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="flex-shrink-0">
                        {product.offerType === 'free-plus-shipping' ? 'F+S' : 'Sale'}
                      </Badge>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenProduct(product.id)}
                      data-testid={`button-open-${product.id}`}
                      title="View details"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditProduct(product.id)}
                      data-testid={`button-edit-${product.id}`}
                      title="Edit product"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteProduct(product.id)}
                      data-testid={`button-delete-${product.id}`}
                      title="Delete product"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground" data-testid="text-no-results">
                {searchQuery || offerTypeFilter !== "all" 
                  ? "No products match your search criteria" 
                  : "No products yet"}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            data-testid="button-prev-page"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          
          <div className="flex items-center gap-2">
            {/* Show first page */}
            {currentPage > 3 && (
              <>
                <Button
                  variant={currentPage === 1 ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePageChange(1)}
                  data-testid="button-page-1"
                >
                  1
                </Button>
                {currentPage > 4 && <span className="text-muted-foreground">...</span>}
              </>
            )}
            
            {/* Show pages around current page */}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(page => {
                return page === currentPage || 
                       page === currentPage - 1 || 
                       page === currentPage + 1 ||
                       (page === currentPage - 2 && currentPage <= 3) ||
                       (page === currentPage + 2 && currentPage >= totalPages - 2);
              })
              .map(page => (
                <Button
                  key={page}
                  variant={currentPage === page ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePageChange(page)}
                  data-testid={`button-page-${page}`}
                >
                  {page}
                </Button>
              ))}
            
            {/* Show last page */}
            {currentPage < totalPages - 2 && (
              <>
                {currentPage < totalPages - 3 && <span className="text-muted-foreground">...</span>}
                <Button
                  variant={currentPage === totalPages ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePageChange(totalPages)}
                  data-testid={`button-page-${totalPages}`}
                >
                  {totalPages}
                </Button>
              </>
            )}
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            data-testid="button-next-page"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      <ProductFormModal
        open={showModal}
        onOpenChange={handleCloseModal}
        onSubmit={handleAddProduct}
        initialData={editingProduct ? {
          name: editingProduct.name,
          displayName: editingProduct.displayName || "",
          offerType: editingProduct.offerType,
          offerLink: editingProduct.offerLink,
          manualContent: editingProduct.manualContent,
          imageUrl: editingProduct.imageUrl || "",
        } : undefined}
      />

      <ProductDetailsDialog
        product={selectedProduct}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onEmailView={handleEmailView}
        onEmailDelete={handleEmailDelete}
        onEmailReuse={handleEmailReuse}
        onEmailStatusChange={handleEmailStatusChange}
      />

      <EmailViewDialog
        email={viewEmail}
        open={viewEmailDialogOpen}
        onOpenChange={setViewEmailDialogOpen}
      />
    </div>
  );
}
