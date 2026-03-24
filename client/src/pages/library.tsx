import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { EmailLibraryCard } from "@/components/email-library-card";
import { EmailViewDialog } from "@/components/email-view-dialog";
import { EmailEditDialog } from "@/components/email-edit-dialog";
import type { Email } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Check, ChevronsUpDown, X, Upload, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export default function LibraryPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [viewEmail, setViewEmail] = useState<Email | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<string>("");
  const [offerComboboxOpen, setOfferComboboxOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [statusComboboxOpen, setStatusComboboxOpen] = useState(false);
  const [creativeSearch, setCreativeSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  
  // Edit dialog state
  const [editEmail, setEditEmail] = useState<Email | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  
  // Import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importTab, setImportTab] = useState("paste");
  const [pastedSubjects, setPastedSubjects] = useState("");
  const [pastedBody, setPastedBody] = useState("");
  const [selectedProductForImport, setSelectedProductForImport] = useState<string>("");
  const [productImportComboboxOpen, setProductImportComboboxOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [googleDriveLink, setGoogleDriveLink] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  // Fetch products from API
  const { data: productsData } = useQuery<{ success: boolean; products: import("@shared/schema").Product[] }>({
    queryKey: ["/api/products"],
  });

  const products = productsData?.products || [];

  // Create a map of product IDs to names for quick lookup
  const productIdToName = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [products]);

  // Fetch emails with pagination (or all if offer filter is active)
  const { data: emailsData, isLoading, error } = useQuery<{ 
    success: boolean; 
    items?: Email[];
    emails?: Email[];
    total: number; 
    totalPages: number; 
    currentPage: number;
  }>({
    queryKey: ["/api/emails", currentPage, itemsPerPage, creativeSearch, selectedStatus, selectedOffer],
    queryFn: async () => {
      // If offer filter is active, fetch all emails and filter client-side
      // (server doesn't support product name filtering)
      if (selectedOffer) {
        const response = await fetch(`/api/emails`);
        if (!response.ok) throw new Error("Failed to fetch emails");
        const data = await response.json();
        let allEmails = data.emails || [];
        
        // Filter by product name
        allEmails = allEmails.filter((email: Email) => {
          const productNames = email.productIds
            .map((id: string) => productIdToName.get(id))
            .filter(Boolean);
          return productNames.includes(selectedOffer);
        });
        
        // Apply status filter if needed
        if (selectedStatus) {
          allEmails = allEmails.filter((email: Email) => email.status === selectedStatus);
        }
        
        // Apply search filter if needed
        if (creativeSearch) {
          const query = creativeSearch.toLowerCase();
          allEmails = allEmails.filter((email: Email) => 
            email.subject.toLowerCase().includes(query) ||
            email.body.toLowerCase().includes(query) ||
            email.subjects?.some((s: string) => s.toLowerCase().includes(query))
          );
        }
        
        // Client-side pagination
        const total = allEmails.length;
        const totalPages = Math.ceil(total / itemsPerPage);
        const offset = (currentPage - 1) * itemsPerPage;
        const items = allEmails.slice(offset, offset + itemsPerPage);
        
        return { success: true, items, total, totalPages, currentPage };
      }
      
      // Otherwise use server-side pagination
      const params = new URLSearchParams();
      params.set("page", currentPage.toString());
      params.set("limit", itemsPerPage.toString());
      if (creativeSearch) params.set("search", creativeSearch);
      if (selectedStatus) params.set("status", selectedStatus);
      
      const response = await fetch(`/api/emails?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch emails");
      return response.json();
    },
  });

  // Extract emails array
  const emails = emailsData?.items || [];
  const totalPages = emailsData?.totalPages || 0;
  const total = emailsData?.total || 0;

  // Fetch specific email for deep linking
  const params = new URLSearchParams(window.location.search);
  const emailIdFromUrl = params.get('email');
  
  const { data: specificEmailData } = useQuery<{ success: boolean; email: Email }>({
    queryKey: ["/api/emails", emailIdFromUrl],
    queryFn: async () => {
      if (!emailIdFromUrl) return { success: false, email: null };
      const response = await fetch(`/api/emails/${emailIdFromUrl}`);
      if (!response.ok) throw new Error("Failed to fetch email");
      return response.json();
    },
    enabled: !!emailIdFromUrl && !viewDialogOpen,
  });

  // Check URL for email ID parameter and open view dialog
  useEffect(() => {
    if (emailIdFromUrl && specificEmailData?.email && !viewDialogOpen) {
      setViewEmail(specificEmailData.email);
      setViewDialogOpen(true);
    }
  }, [emailIdFromUrl, specificEmailData, viewDialogOpen]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [creativeSearch, selectedStatus, selectedOffer]);

  // Get unique products from all products (not filtered emails)
  const uniqueProducts = useMemo(() => {
    return products.map(p => p.name).sort();
  }, [products]);

  // Predefined status options
  const uniqueStatuses = [
    "needs-review",
    "document", 
    "needs-testing",
    "testing",
    "winner",
    "loser"
  ];

  // Status definitions for glossary
  const statusDefinitions = {
    "needs-review": "Just generated, needs approval from a Copy Controller",
    "document": "This email needs to be Added to the Email Creative Transfer Sheet, and Added to Everflow",
    "needs-testing": "Needs to be tested to live traffic",
    "testing": "Currently testing to live traffic",
    "winner": "Email performed at or above average",
    "loser": "Email performed below average"
  };

  const updateStatusMutation = useMutation({
    mutationFn: async ({ emailId, status }: { emailId: string; status: string }) => {
      return await apiRequest("PATCH", `/api/emails/${emailId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      toast({
        title: "Success",
        description: "Email status updated",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update status",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (emailId: string) => {
      return await apiRequest("DELETE", `/api/emails/${emailId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      toast({
        title: "Success",
        description: "Email deleted from library",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete email",
      });
    },
  });

  const updateEmailMutation = useMutation({
    mutationFn: async ({ emailId, data }: { emailId: string; data: any }) => {
      return await apiRequest("PATCH", `/api/emails/${emailId}`, {
        ...data,
        edited: 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      toast({
        title: "Success",
        description: "Email updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update email",
      });
    },
  });

  const handleStatusChange = (id: string, status: string) => {
    updateStatusMutation.mutate({ emailId: id, status });
  };

  const handleView = (id: string) => {
    const email = emails.find((e) => e.id === id);
    if (email) {
      setViewEmail(email);
      setViewDialogOpen(true);
      // Update URL with email ID for sharing
      window.history.pushState({}, '', `/library?email=${id}`);
    }
  };

  const handleViewDialogClose = (open: boolean) => {
    setViewDialogOpen(open);
    if (!open) {
      // Clear URL parameter when dialog closes
      window.history.pushState({}, '', '/library');
    }
  };

  const handleEdit = (id: string) => {
    const email = emails.find((e) => e.id === id);
    if (email) {
      setEditEmail(email);
      setEditDialogOpen(true);
    }
  };

  const handleEditDialogClose = (open: boolean) => {
    setEditDialogOpen(open);
  };

  const handleEditSave = (data: {
    productIds: string[];
    subjects: string[];
    subject: string;
    body: string;
  }) => {
    if (editEmail) {
      updateEmailMutation.mutate({
        emailId: editEmail.id,
        data,
      });
    }
  };

  const handleReuse = (id: string) => {
    const email = emails.find((e) => e.id === id);
    if (email) {
      setLocation(`/?reuse=${id}`);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this email?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      let subjects: string[] = [];
      let body = "";

      // Process based on active tab
      if (importTab === "paste") {
        // Parse pasted text
        subjects = pastedSubjects.split('\n').filter(s => s.trim());
        body = pastedBody;
      } else if (importTab === "file") {
        // Read file content
        if (!importFile) {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Please select a file to upload",
          });
          return;
        }

        const fileContent = await importFile.text();
        
        // Try to parse HTML for subject and body
        if (importFile.name.endsWith('.html') || importFile.name.endsWith('.htm')) {
          // Extract subject from title tag or first h1
          const titleMatch = fileContent.match(/<title>(.*?)<\/title>/i);
          const h1Match = fileContent.match(/<h1>(.*?)<\/h1>/i);
          subjects = [(titleMatch?.[1] || h1Match?.[1] || "Imported Email").trim()];
          
          // Extract body content (remove html, head, script tags)
          body = fileContent
            .replace(/<head>[\s\S]*?<\/head>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<\/?html>/gi, '')
            .replace(/<\/?body>/gi, '')
            .trim();
        } else {
          // Plain text file - first line is subject, rest is body
          const lines = fileContent.split('\n');
          subjects = lines[0] ? [lines[0].trim()] : ["Imported Email"];
          body = lines.slice(1).join('\n').trim();
        }
      } else if (importTab === "drive") {
        // Fetch Google Drive content
        if (!googleDriveLink.trim()) {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Please enter a Google Drive link",
          });
          return;
        }

        toast({
          title: "Info",
          description: "Google Drive import coming soon. For now, please copy and paste the content directly.",
        });
        setIsImporting(false);
        return;
      }

      // Validate
      if (!selectedProductForImport) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please select a product to assign this email to",
        });
        setIsImporting(false);
        return;
      }

      if (!body.trim()) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Email body cannot be empty",
        });
        setIsImporting(false);
        return;
      }

      if (subjects.length === 0) {
        subjects = ["Imported Email"];
      }

      // Save to library using existing API
      const emailData = {
        subjects,
        subject: subjects[0],
        body,
        productIds: [selectedProductForImport],
        tone: "imported",
        status: "needs-testing",
      };

      const response = await apiRequest("POST", "/api/emails", emailData);
      
      // Check response status first
      if (!response.ok) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to import email",
        });
        return;
      }

      const result = await response.json();

      toast({
        title: "Success",
        description: "Email imported to library successfully",
      });
      
      // Reset form
      setPastedSubjects("");
      setPastedBody("");
      setSelectedProductForImport("");
      setImportFile(null);
      setGoogleDriveLink("");
      setImportDialogOpen(false);
      
      // Refresh emails list
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
    } catch (error) {
      console.error("Import error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "An error occurred while importing the email",
      });
    } finally {
      setIsImporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Email Library</h1>
          <p className="text-muted-foreground mt-1">
            Review past campaigns and track performance
          </p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Email Library</h1>
          <p className="text-muted-foreground mt-1">
            Review past campaigns and track performance
          </p>
        </div>
        <Card>
          <CardContent className="p-6">
            <p className="text-destructive">Error loading emails: {error.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Email Library</h1>
          <p className="text-muted-foreground mt-1">
            Review past campaigns and track performance
          </p>
        </div>
        <Button onClick={() => setImportDialogOpen(true)} data-testid="button-import-creative">
          <Upload className="h-4 w-4 mr-2" />
          Import Creative
        </Button>
      </div>

      {emails.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Offer Filter */}
          <div className="space-y-2">
            <Label htmlFor="offer-filter">Filter by Offer</Label>
            <div className="flex gap-2">
              <Popover open={offerComboboxOpen} onOpenChange={setOfferComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={offerComboboxOpen}
                    className="flex-1 justify-between"
                    id="offer-filter"
                    data-testid="button-offer-filter"
                  >
                    {selectedOffer || "All offers"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search offers..." data-testid="input-offer-search" />
                    <CommandList>
                      <CommandEmpty>No offers found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value=""
                          onSelect={() => {
                            setSelectedOffer("");
                            setOfferComboboxOpen(false);
                          }}
                          data-testid="command-item-all-offers"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              !selectedOffer ? "opacity-100" : "opacity-0"
                            )}
                          />
                          All offers
                        </CommandItem>
                        {uniqueProducts.map((productName) => (
                          <CommandItem
                            key={productName}
                            value={productName}
                            onSelect={() => {
                              setSelectedOffer(productName);
                              setOfferComboboxOpen(false);
                            }}
                            data-testid={`command-item-offer-${productName}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedOffer === productName ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {productName}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedOffer && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedOffer("")}
                  data-testid="button-clear-offer-filter"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Status Filter */}
          <div className="space-y-2">
            <Label htmlFor="status-filter">Filter by Status</Label>
            <div className="flex gap-2">
              <Popover open={statusComboboxOpen} onOpenChange={setStatusComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={statusComboboxOpen}
                    className="flex-1 justify-between"
                    id="status-filter"
                    data-testid="button-status-filter"
                  >
                    {selectedStatus ? selectedStatus.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : "All statuses"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search statuses..." data-testid="input-status-search" />
                    <CommandList>
                      <CommandEmpty>No statuses found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value=""
                          onSelect={() => {
                            setSelectedStatus("");
                            setStatusComboboxOpen(false);
                          }}
                          data-testid="command-item-all-statuses"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              !selectedStatus ? "opacity-100" : "opacity-0"
                            )}
                          />
                          All statuses
                        </CommandItem>
                        {uniqueStatuses.map((status) => (
                          <CommandItem
                            key={status}
                            value={status}
                            onSelect={() => {
                              setSelectedStatus(status);
                              setStatusComboboxOpen(false);
                            }}
                            data-testid={`command-item-status-${status}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedStatus === status ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedStatus && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedStatus("")}
                  data-testid="button-clear-status-filter"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Creative Search Filter */}
          <div className="space-y-2">
            <Label htmlFor="creative-search">Search Email Copy or Subjects</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                id="creative-search"
                placeholder="Search subject lines or email body..."
                value={creativeSearch}
                onChange={(e) => setCreativeSearch(e.target.value)}
                className="pl-9"
                data-testid="input-creative-search"
              />
            </div>
          </div>
        </div>
      )}

      {/* Status Glossary */}
      {emails.length > 0 && (
        <Card data-testid="card-status-glossary">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Status Glossary</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(statusDefinitions).map(([status, description]) => (
              <div key={status} className="flex gap-3 text-sm">
                <span className="font-semibold min-w-[120px] capitalize" data-testid={`glossary-status-${status}`}>
                  {status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}:
                </span>
                <span className="text-muted-foreground" data-testid={`glossary-description-${status}`}>
                  {description}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {total === 0 && !isLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">
              {creativeSearch || selectedStatus ? (
                <>
                  No emails found matching your filters.
                  {selectedStatus && ` Try removing the status filter.`}
                  {creativeSearch && ` Try a different search term.`}
                </>
              ) : (
                "No saved emails yet. Generate and save some emails to see them here!"
              )}
            </p>
            {(selectedStatus || creativeSearch) && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setSelectedStatus("");
                  setCreativeSearch("");
                }}
                data-testid="button-clear-all-filters"
              >
                Clear All Filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4">
            {emails.map((email) => {
              // Map product IDs to product names
              const productNames = email.productIds
                .map((id: string) => productIdToName.get(id) || "Unknown Product")
                .filter(Boolean);
              
              return (
                <EmailLibraryCard
                  key={email.id}
                  id={email.id}
                  subject={email.subject}
                  body={email.body}
                  productNames={productNames}
                  status={email.status as "needs-review" | "document" | "needs-testing" | "testing" | "winner" | "loser" | undefined}
                  openRate={email.openRate ?? undefined}
                  clickRate={email.clickRate ?? undefined}
                  createdAt={new Date(email.createdAt)}
                  onView={handleView}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onReuse={handleReuse}
                  onStatusChange={handleStatusChange}
                />
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                data-testid="button-prev-page"
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-page-info">
                Page {currentPage} of {totalPages} ({total} total)
              </span>
              <Button
                variant="outline"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                data-testid="button-next-page"
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      <EmailViewDialog
        email={viewEmail}
        open={viewDialogOpen}
        onOpenChange={handleViewDialogClose}
        onEdit={handleEdit}
        productIdToName={productIdToName}
      />

      <EmailEditDialog
        email={editEmail}
        open={editDialogOpen}
        onOpenChange={handleEditDialogClose}
        onSave={handleEditSave}
      />

      {/* Import Creative Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Email Creative</DialogTitle>
            <DialogDescription>
              Import an existing email creative to your library
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={importTab} onValueChange={setImportTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="paste" data-testid="tab-paste-text">Paste Text</TabsTrigger>
              <TabsTrigger value="file" data-testid="tab-upload-file">Upload File</TabsTrigger>
              <TabsTrigger value="drive" data-testid="tab-google-drive">Google Drive</TabsTrigger>
            </TabsList>
            
            <TabsContent value="paste" className="flex-1 flex flex-col gap-4 min-h-0">
              <div className="space-y-2">
                <Label htmlFor="import-subjects">Subject Lines (one per line)</Label>
                <Textarea
                  id="import-subjects"
                  placeholder="Subject line 1&#10;Subject line 2&#10;Subject line 3"
                  value={pastedSubjects}
                  onChange={(e) => setPastedSubjects(e.target.value)}
                  className="min-h-[100px]"
                  data-testid="textarea-import-subjects"
                />
              </div>
              
              <div className="space-y-2 flex-1 flex flex-col min-h-0">
                <Label htmlFor="import-body">Email Body (HTML or plain text)</Label>
                <Textarea
                  id="import-body"
                  placeholder="Paste your email content here..."
                  value={pastedBody}
                  onChange={(e) => setPastedBody(e.target.value)}
                  className="flex-1 min-h-0 resize-none"
                  data-testid="textarea-import-body"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="import-product">Assign to Product</Label>
                <Popover open={productImportComboboxOpen} onOpenChange={setProductImportComboboxOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={productImportComboboxOpen}
                      className="w-full justify-between"
                      id="import-product"
                      data-testid="button-import-product"
                    >
                      {selectedProductForImport
                        ? products.find((p) => p.id === selectedProductForImport)?.name
                        : "Select product..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search products..." data-testid="input-search-paste-products" />
                      <CommandList>
                        <CommandEmpty>No products found.</CommandEmpty>
                        <CommandGroup>
                          {products.map((product) => (
                            <CommandItem
                              key={product.id}
                              value={product.name}
                              onSelect={() => {
                                setSelectedProductForImport(product.id);
                                setProductImportComboboxOpen(false);
                              }}
                              data-testid={`command-item-import-paste-product-${product.id}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedProductForImport === product.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {product.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </TabsContent>
            
            <TabsContent value="file" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="import-file">Upload Email File</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept=".txt,.html,.htm"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  data-testid="input-import-file"
                />
                {importFile && (
                  <p className="text-sm text-foreground" data-testid="text-selected-filename">
                    Selected: {importFile.name}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Supported formats: .txt, .html
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="file-product">Assign to Product</Label>
                <Popover open={productImportComboboxOpen} onOpenChange={setProductImportComboboxOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={productImportComboboxOpen}
                      className="w-full justify-between"
                      id="file-product"
                      data-testid="button-import-file-product"
                    >
                      {selectedProductForImport
                        ? products.find((p) => p.id === selectedProductForImport)?.name
                        : "Select product..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search products..." data-testid="input-search-file-products" />
                      <CommandList>
                        <CommandEmpty>No products found.</CommandEmpty>
                        <CommandGroup>
                          {products.map((product) => (
                            <CommandItem
                              key={product.id}
                              value={product.name}
                              onSelect={() => {
                                setSelectedProductForImport(product.id);
                                setProductImportComboboxOpen(false);
                              }}
                              data-testid={`command-item-import-file-product-${product.id}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedProductForImport === product.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {product.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </TabsContent>
            
            <TabsContent value="drive" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="drive-link">Google Drive Link</Label>
                <Input
                  id="drive-link"
                  type="url"
                  placeholder="https://docs.google.com/document/d/..."
                  value={googleDriveLink}
                  onChange={(e) => setGoogleDriveLink(e.target.value)}
                  data-testid="input-drive-link"
                />
                <p className="text-xs text-muted-foreground">
                  Paste a link to a publicly shared Google Doc
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="drive-product">Assign to Product</Label>
                <Popover open={productImportComboboxOpen} onOpenChange={setProductImportComboboxOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={productImportComboboxOpen}
                      className="w-full justify-between"
                      id="drive-product"
                      data-testid="button-import-drive-product"
                    >
                      {selectedProductForImport
                        ? products.find((p) => p.id === selectedProductForImport)?.name
                        : "Select product..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search products..." data-testid="input-search-drive-products" />
                      <CommandList>
                        <CommandEmpty>No products found.</CommandEmpty>
                        <CommandGroup>
                          {products.map((product) => (
                            <CommandItem
                              key={product.id}
                              value={product.name}
                              onSelect={() => {
                                setSelectedProductForImport(product.id);
                                setProductImportComboboxOpen(false);
                              }}
                              data-testid={`command-item-import-drive-product-${product.id}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedProductForImport === product.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {product.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </TabsContent>
          </Tabs>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)} disabled={isImporting}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={isImporting} data-testid="button-confirm-import">
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import to Library"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
