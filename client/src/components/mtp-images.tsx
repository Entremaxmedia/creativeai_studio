import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Loader2, Upload, Copy, Search, ExternalLink, Check, FolderPlus, Folder, ChevronRight, ChevronDown, ChevronLeft, Home, Link2, MoreVertical, Pencil, FolderOpen, CheckSquare, Square, X, ArrowRight, Filter, Image as ImageIcon, Film, FileImage } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import StructuredFilenameDialog from "@/components/image-generator/structured-filename-dialog";

interface MTPImage {
  key: string;
  size: number;
  lastModified: string;
  url: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface MTPFolder {
  id: string;
  name: string;
  parentId: string | null;
  shareCode: string | null;
  createdAt: string;
}

interface FolderTreeItemProps {
  folder: MTPFolder;
  folders: MTPFolder[];
  currentFolderId: string | null;
  expandedFolders: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelectFolder: (id: string | null) => void;
  onMoveFolder: (folderId: string, newParentId: string | null) => void;
  level: number;
  highlightIds?: Set<string>;
  draggedFolderId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}

const STANDARD_RATIOS: Array<{ label: string; ratio: number }> = [
  { label: "1:1", ratio: 1 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "4:5", ratio: 4 / 5 },
  { label: "5:4", ratio: 5 / 4 },
  { label: "21:9", ratio: 21 / 9 },
];

function classifyAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  for (const sr of STANDARD_RATIOS) {
    if (Math.abs(ratio - sr.ratio) < 0.03) return sr.label;
  }
  return "Custom";
}

interface ImageCardProps {
  image: MTPImage;
  bulkSelectMode: boolean;
  isSelected: boolean;
  copiedUrl: string | null;
  fileType: 'image' | 'video' | 'gif';
  onDimensionsLoaded: (key: string, dims: ImageDimensions) => void;
  onToggleSelection: () => void;
  onCopyUrl: (url: string) => void;
  onDelete: () => void;
  formatFileSize: (bytes: number) => string;
  getFileName: (key: string) => string;
}

function ImageCard({ image, bulkSelectMode, isSelected, copiedUrl, fileType, onDimensionsLoaded, onToggleSelection, onCopyUrl, onDelete, formatFileSize, getFileName }: ImageCardProps) {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  
  useEffect(() => {
    if (fileType === 'video') return;
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      setDimensions(dims);
      onDimensionsLoaded(image.key, dims);
    };
    img.src = image.url;
  }, [image.url, fileType]);

  const getAspectRatioString = (width: number, height: number): string => {
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(width, height);
    const w = width / divisor;
    const h = height / divisor;
    if (w > 100 || h > 100) {
      const ratio = width / height;
      if (Math.abs(ratio - 16/9) < 0.01) return "16:9";
      if (Math.abs(ratio - 9/16) < 0.01) return "9:16";
      if (Math.abs(ratio - 4/3) < 0.01) return "4:3";
      if (Math.abs(ratio - 3/4) < 0.01) return "3:4";
      if (Math.abs(ratio - 1) < 0.01) return "1:1";
      return `${ratio.toFixed(2)}:1`;
    }
    return `${w}:${h}`;
  };

  return (
    <Card 
      className={`overflow-hidden ${bulkSelectMode && isSelected ? 'ring-2 ring-primary' : ''}`} 
      data-testid={`card-mtp-image-${image.key}`}
    >
      <CardContent className="p-0 relative group">
        {bulkSelectMode && (
          <button
            className="absolute top-2 left-2 z-10 bg-background/80 rounded p-1"
            onClick={onToggleSelection}
            data-testid={`checkbox-image-${image.key}`}
          >
            {isSelected ? (
              <CheckSquare className="h-5 w-5 text-primary" />
            ) : (
              <Square className="h-5 w-5" />
            )}
          </button>
        )}
        {fileType === 'video' ? (
          <div className="w-full aspect-square bg-muted flex items-center justify-center relative">
            <video
              src={image.url}
              className="w-full h-full object-cover"
              muted
              loop
              playsInline
              onMouseEnter={(e) => e.currentTarget.play()}
              onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                const dims = { width: v.videoWidth, height: v.videoHeight };
                setDimensions(dims);
                onDimensionsLoaded(image.key, dims);
              }}
            />
            <div className="absolute bottom-2 left-2 pointer-events-none">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                <Film className="h-3 w-3 mr-1" />
                Video
              </Badge>
            </div>
          </div>
        ) : (
          <>
            <img
              src={image.url}
              alt={getFileName(image.key)}
              className="w-full aspect-square object-cover"
              loading="lazy"
            />
            {fileType === 'gif' && (
              <div className="absolute bottom-2 left-2 pointer-events-none">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                  GIF
                </Badge>
              </div>
            )}
          </>
        )}
        <a
          href={image.url}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          data-testid={`link-mtp-open-${image.key}`}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </CardContent>
      <CardContent className="p-3 space-y-2">
        <p className="text-sm font-medium truncate" title={getFileName(image.key)}>
          {getFileName(image.key)}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span>{formatFileSize(image.size)}</span>
          {dimensions && (
            <>
              <span>•</span>
              <span>{dimensions.width}x{dimensions.height}</span>
              <span>•</span>
              <span>{getAspectRatioString(dimensions.width, dimensions.height)}</span>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onCopyUrl(image.url)}
            data-testid={`button-mtp-copy-${image.key}`}
          >
            {copiedUrl === image.url ? (
              <Check className="mr-1 h-3 w-3" />
            ) : (
              <Copy className="mr-1 h-3 w-3" />
            )}
            {copiedUrl === image.url ? 'Copied' : 'Copy Link'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            data-testid={`button-mtp-delete-${image.key}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function isDescendant(folders: MTPFolder[], folderId: string, potentialParentId: string): boolean {
  let current = folders.find(f => f.id === potentialParentId);
  while (current) {
    if (current.id === folderId) return true;
    current = current.parentId ? folders.find(f => f.id === current!.parentId) : undefined;
  }
  return false;
}

function FolderTreeItem({ folder, folders, currentFolderId, expandedFolders, onToggleExpand, onSelectFolder, onMoveFolder, level, highlightIds, draggedFolderId, onDragStart, onDragEnd }: FolderTreeItemProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const wasDraggingRef = useRef(false);
  const children = folders.filter(f => f.parentId === folder.id);
  const filteredChildren = highlightIds ? children.filter(c => highlightIds.has(c.id)) : children;
  const hasChildren = filteredChildren.length > 0;
  const isExpanded = expandedFolders.has(folder.id);
  const isSelected = currentFolderId === folder.id;
  const isHighlighted = highlightIds?.has(folder.id);
  const isDragging = draggedFolderId === folder.id;
  const isValidDropTarget = draggedFolderId !== null && draggedFolderId !== folder.id && !isDescendant(folders, draggedFolderId, folder.id) && folder.parentId !== draggedFolderId;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-folder-id', folder.id);
    e.dataTransfer.effectAllowed = 'move';
    wasDraggingRef.current = true;
    onDragStart(folder.id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isValidDropTarget) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const droppedFolderId = e.dataTransfer.getData('application/x-folder-id');
    if (droppedFolderId && droppedFolderId !== folder.id && !isDescendant(folders, droppedFolderId, folder.id)) {
      onMoveFolder(droppedFolderId, folder.id);
    }
  };

  const handleDragEnd = () => {
    setIsDragOver(false);
    onDragEnd();
    setTimeout(() => { wasDraggingRef.current = false; }, 0);
  };

  const handleClick = () => {
    if (wasDraggingRef.current) return;
    onSelectFolder(folder.id);
  };

  return (
    <div>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        className={`flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer transition-colors ${
          isSelected ? 'bg-primary/10 text-primary' : 'hover-elevate'
        } ${isHighlighted && !isSelected ? 'font-medium' : ''} ${isDragging ? 'opacity-50' : ''} ${isDragOver && isValidDropTarget ? 'ring-2 ring-primary bg-primary/5' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
        data-testid={`folder-tree-item-${folder.id}`}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(folder.id);
            }}
            className="p-0.5 hover:bg-muted rounded"
            data-testid={`folder-expand-${folder.id}`}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        {isSelected ? (
          <FolderOpen className="h-4 w-4 text-primary shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="truncate text-sm">{folder.name}</span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {filteredChildren.map(child => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              folders={folders}
              currentFolderId={currentFolderId}
              expandedFolders={expandedFolders}
              onToggleExpand={onToggleExpand}
              onSelectFolder={onSelectFolder}
              onMoveFolder={onMoveFolder}
              level={level + 1}
              highlightIds={highlightIds}
              draggedFolderId={draggedFolderId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const ITEMS_PER_PAGE = 50;

export default function MTPImages() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [fileTypeFilter, setFileTypeFilter] = useState<string>("all");
  const [aspectRatioFilter, setAspectRatioFilter] = useState<string>("all");
  const [dimensionsMap, setDimensionsMap] = useState<Map<string, ImageDimensions>>(new Map());
  const [deleteImageKey, setDeleteImageKey] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [showUploadNamingDialog, setShowUploadNamingDialog] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  
  // Folder state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const [showRenameFolderDialog, setShowRenameFolderDialog] = useState(false);
  const [showDeleteFolderDialog, setShowDeleteFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderToEdit, setFolderToEdit] = useState<MTPFolder | null>(null);
  
  // Bulk selection state
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [showMoveToFolderDialog, setShowMoveToFolderDialog] = useState(false);
  const [folderSearchTerm, setFolderSearchTerm] = useState("");
  const [sidebarFolderSearch, setSidebarFolderSearch] = useState("");

  // Drag-and-drop state for folders
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [isRootDragOver, setIsRootDragOver] = useState(false);
  const [showMoveFolderDialog, setShowMoveFolderDialog] = useState(false);
  const [folderToMove, setFolderToMove] = useState<MTPFolder | null>(null);
  const [moveFolderSearchTerm, setMoveFolderSearchTerm] = useState("");

  // Fetch folders
  const { data: foldersData } = useQuery<{
    success: boolean;
    folders: MTPFolder[];
  }>({
    queryKey: ['/api/mtp-folders'],
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev: any) => prev,
  });
  
  const folders = foldersData?.folders || [];

  // Get images in current folder
  const { data: folderImagesData } = useQuery<{
    success: boolean;
    imageKeys: string[];
  }>({
    queryKey: ['/api/mtp-folders', currentFolderId, 'images'],
    queryFn: async () => {
      if (!currentFolderId) return { success: true, imageKeys: [] };
      const response = await fetch(`/api/mtp-folders/${currentFolderId}/images`);
      return response.json();
    },
    enabled: !!currentFolderId,
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev: any) => prev,
  });

  const folderImageKeys = new Set(folderImagesData?.imageKeys || []);

  const { data: imagesData, isLoading, error, refetch } = useQuery<{
    success: boolean;
    items: MTPImage[];
    total: number;
    error?: string;
    code?: string;
  }>({
    queryKey: ['/api/mtp-images', searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchTerm) {
        params.append('search', searchTerm);
      }
      const url = `/api/mtp-images?${params}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          items: [],
          total: 0,
          error: data.error || "Failed to fetch images",
          code: data.code || "UNKNOWN_ERROR",
        };
      }
      return data;
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });

  const isNotConfigured = imagesData?.code === "NOT_CONFIGURED" || 
    (imagesData?.error?.includes("not configured")) ||
    (error && String(error).includes("503"));

  const getFileExtension = (key: string): string => {
    const match = key.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : '';
  };

  const getFileType = (key: string): 'image' | 'video' | 'gif' => {
    const ext = getFileExtension(key);
    if (ext === 'gif') return 'gif';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
    return 'image';
  };

  const allImages = imagesData?.items || [];
  const folderFiltered = currentFolderId 
    ? allImages.filter(img => folderImageKeys.has(img.key))
    : allImages;

  const availableExtensions = useMemo(() => {
    const extCounts = new Map<string, number>();
    for (const img of folderFiltered) {
      const ext = getFileExtension(img.key);
      if (ext) {
        extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
      }
    }
    return Array.from(extCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => ({ ext, count }));
  }, [folderFiltered]);

  const handleDimensionsLoaded = useCallback((key: string, dims: ImageDimensions) => {
    setDimensionsMap(prev => {
      if (prev.get(key)?.width === dims.width && prev.get(key)?.height === dims.height) return prev;
      const next = new Map(prev);
      next.set(key, dims);
      return next;
    });
  }, []);

  const typeFiltered = fileTypeFilter === 'all' 
    ? folderFiltered 
    : folderFiltered.filter(img => getFileExtension(img.key) === fileTypeFilter);

  const images = aspectRatioFilter === 'all'
    ? typeFiltered
    : typeFiltered.filter(img => {
        const dims = dimensionsMap.get(img.key);
        if (!dims) return false;
        return classifyAspectRatio(dims.width, dims.height) === aspectRatioFilter;
      });
  const totalImages = images.length;
  const totalUnfiltered = folderFiltered.length;

  const totalPages = Math.max(1, Math.ceil(totalImages / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedImages = images.slice(
    (safeCurrentPage - 1) * ITEMS_PER_PAGE,
    safeCurrentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, fileTypeFilter, aspectRatioFilter, currentFolderId]);

  const availableAspectRatios = useMemo(() => {
    const ratioCounts = new Map<string, number>();
    for (const img of folderFiltered) {
      const dims = dimensionsMap.get(img.key);
      if (dims) {
        const label = classifyAspectRatio(dims.width, dims.height);
        ratioCounts.set(label, (ratioCounts.get(label) || 0) + 1);
      }
    }
    const order = STANDARD_RATIOS.map(sr => sr.label);
    return Array.from(ratioCounts.entries())
      .sort((a, b) => {
        const ai = order.indexOf(a[0]);
        const bi = order.indexOf(b[0]);
        if (ai === -1 && bi === -1) return b[1] - a[1];
        if (ai === -1) return 1;
        if (bi === -1) return 1;
        return ai - bi;
      })
      .map(([label, count]) => ({ label, count }));
  }, [folderFiltered, dimensionsMap]);

  // Folder mutations
  const createFolderMutation = useMutation({
    mutationFn: async ({ name, parentId }: { name: string; parentId: string | null }) => {
      const response = await fetch('/api/mtp-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
      });
      if (!response.ok) throw new Error("Failed to create folder");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-folders'] });
      setShowCreateFolderDialog(false);
      setNewFolderName("");
      toast({ title: "Folder Created", description: "Your new folder has been created" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create folder", variant: "destructive" });
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const response = await fetch(`/api/mtp-folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error("Failed to rename folder");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-folders'] });
      setShowRenameFolderDialog(false);
      setFolderToEdit(null);
      setNewFolderName("");
      toast({ title: "Folder Renamed", description: "Your folder has been renamed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to rename folder", variant: "destructive" });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/mtp-folders/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error("Failed to delete folder");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-folders'] });
      setShowDeleteFolderDialog(false);
      setFolderToEdit(null);
      if (currentFolderId === folderToEdit?.id) {
        setCurrentFolderId(null);
      }
      toast({ title: "Folder Deleted", description: "Your folder has been deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete folder", variant: "destructive" });
    },
  });

  const moveFolderMutation = useMutation({
    mutationFn: async ({ folderId, newParentId }: { folderId: string; newParentId: string | null }) => {
      const response = await fetch(`/api/mtp-folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: newParentId }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to move folder");
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-folders'] });
      if (variables.newParentId) {
        setExpandedFolders(prev => {
          const next = new Set(prev);
          next.add(variables.newParentId!);
          return next;
        });
      }
      toast({ title: "Folder Moved", description: "Folder has been moved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Move Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleMoveFolder = (folderId: string, newParentId: string | null) => {
    if (folderId === newParentId) return;
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;
    if (folder.parentId === newParentId) return;
    if (newParentId && isDescendant(folders, folderId, newParentId)) {
      toast({ title: "Invalid Move", description: "Cannot move a folder into one of its own subfolders", variant: "destructive" });
      return;
    }
    moveFolderMutation.mutate({ folderId, newParentId });
  };

  const moveImagesMutation = useMutation({
    mutationFn: async ({ imageKeys, folderId }: { imageKeys: string[]; folderId: string }) => {
      const response = await fetch(`/api/mtp-folders/${folderId}/images/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageKeys }),
      });
      if (!response.ok) throw new Error("Failed to move images");
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-folders'] });
      setShowMoveToFolderDialog(false);
      setBulkSelectMode(false);
      setSelectedImages(new Set());
      toast({ 
        title: "Images Moved", 
        description: `${variables.imageKeys.length} image(s) moved to folder` 
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to move images", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      const response = await fetch(`/api/mtp-images/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error("Failed to delete image");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-images'] });
      toast({
        title: "Image Deleted",
        description: "The image has been removed from your library",
      });
      setDeleteImageKey(null);
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
      setDeleteImageKey(null);
    },
  });

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPendingUploadFiles(Array.from(files));
    setShowUploadNamingDialog(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUploadWithNaming = async (filename: string, folderId?: number) => {
    if (pendingUploadFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress({ current: 0, total: pendingUploadFiles.length });
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < pendingUploadFiles.length; i++) {
      const file = pendingUploadFiles[i];
      setUploadProgress({ current: i + 1, total: pendingUploadFiles.length });
      try {
        const originalExt = file.name.includes('.') 
          ? file.name.substring(file.name.lastIndexOf('.')) 
          : '.png';
        const formData = new FormData();
        formData.append('filename', filename);
        formData.append('file', file, `${filename}${originalExt}`);
        if (folderId) {
          formData.append('folderId', folderId.toString());
        }

        const response = await fetch('/api/mtp-images/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Upload failed");
        }

        successCount++;
      } catch (error) {
        console.error("Upload error:", error);
        errorCount++;
      }
    }

    setIsUploading(false);
    setUploadProgress({ current: 0, total: 0 });
    
    if (successCount > 0) {
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-images'] });
      if (folderId) {
        queryClient.invalidateQueries({ queryKey: ['/api/mtp-folders'] });
      }
      toast({
        title: "Upload Complete",
        description: `${successCount} file${successCount > 1 ? 's' : ''} uploaded successfully${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
      });
    } else if (errorCount > 0) {
      toast({
        title: "Upload Failed",
        description: `Failed to upload ${errorCount} file${errorCount > 1 ? 's' : ''}`,
        variant: "destructive",
      });
    }

    if (errorCount === 0) {
      setPendingUploadFiles([]);
      setShowUploadNamingDialog(false);
    }
  };

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      toast({
        title: "Link Copied",
        description: "Image URL copied to clipboard",
      });
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy link to clipboard",
        variant: "destructive",
      });
    }
  };

  const copyShareLink = async (folder: MTPFolder) => {
    const shareUrl = `${window.location.origin}/shared/${folder.shareCode}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: "Share Link Copied",
        description: "Folder share link copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy share link",
        variant: "destructive",
      });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileName = (key: string) => {
    return key.split('/').pop() || key;
  };

  const toggleExpand = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleImageSelection = (key: string) => {
    setSelectedImages(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllImages = () => {
    setSelectedImages(new Set(images.map(img => img.key)));
  };

  const clearSelection = () => {
    setSelectedImages(new Set());
  };

  // Get breadcrumb path
  const getBreadcrumbPath = (): MTPFolder[] => {
    if (!currentFolderId) return [];
    const path: MTPFolder[] = [];
    let current = folders.find(f => f.id === currentFolderId);
    while (current) {
      path.unshift(current);
      current = current.parentId ? folders.find(f => f.id === current!.parentId) : undefined;
    }
    return path;
  };

  const breadcrumbPath = getBreadcrumbPath();
  const currentFolder = folders.find(f => f.id === currentFolderId);
  const rootFolders = folders.filter(f => !f.parentId);
  
  // Filter folders for sidebar search - show matching folders and their parents
  const getMatchingFolderIds = (searchTerm: string): Set<string> => {
    if (!searchTerm.trim()) return new Set();
    const lowerSearch = searchTerm.toLowerCase();
    const matchingIds = new Set<string>();
    
    // Find folders that match the search
    folders.forEach(folder => {
      if (folder.name.toLowerCase().includes(lowerSearch)) {
        matchingIds.add(folder.id);
        // Also add all parent folders to show the path
        let parentId = folder.parentId;
        while (parentId) {
          matchingIds.add(parentId);
          const parent = folders.find(f => f.id === parentId);
          parentId = parent?.parentId || null;
        }
      }
    });
    return matchingIds;
  };
  
  const matchingFolderIds = getMatchingFolderIds(sidebarFolderSearch);
  const filteredRootFolders = sidebarFolderSearch.trim() 
    ? rootFolders.filter(f => matchingFolderIds.has(f.id))
    : rootFolders;

  // Filter folders for move dialog
  const filteredFolders = folders.filter(f => 
    f.name.toLowerCase().includes(folderSearchTerm.toLowerCase())
  );

  return (
    <div className="flex gap-4 h-full">
      {/* Folder Sidebar */}
      <Card className="w-64 shrink-0 flex flex-col">
        <CardContent className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">Folders</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setShowCreateFolderDialog(true);
                setNewFolderName("");
              }}
              data-testid="button-create-folder"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search folders..."
              value={sidebarFolderSearch}
              onChange={(e) => setSidebarFolderSearch(e.target.value)}
              className="pl-7 h-8 text-sm"
              data-testid="input-folder-search"
            />
          </div>
        </CardContent>
        <ScrollArea className="flex-1">
          <CardContent className="p-2">
            {/* All Images - also a drop target to move folders to root */}
            <div
              className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors ${
                currentFolderId === null ? 'bg-primary/10 text-primary' : 'hover-elevate'
              } ${isRootDragOver ? 'ring-2 ring-primary bg-primary/5' : ''}`}
              onClick={() => setCurrentFolderId(null)}
              onDragOver={(e) => {
                if (draggedFolderId) {
                  const folder = folders.find(f => f.id === draggedFolderId);
                  if (folder && folder.parentId !== null) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setIsRootDragOver(true);
                  }
                }
              }}
              onDragLeave={() => setIsRootDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsRootDragOver(false);
                const droppedFolderId = e.dataTransfer.getData('application/x-folder-id');
                if (droppedFolderId) {
                  handleMoveFolder(droppedFolderId, null);
                }
              }}
              data-testid="folder-all-images"
            >
              <Home className="h-4 w-4" />
              <span className="text-sm">All Images</span>
            </div>
            
            {/* Folder Tree */}
            <div className="mt-2">
              {filteredRootFolders.length === 0 && sidebarFolderSearch.trim() ? (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No folders found
                </p>
              ) : (
                filteredRootFolders.map(folder => (
                  <FolderTreeItem
                    key={folder.id}
                    folder={folder}
                    folders={folders}
                    currentFolderId={currentFolderId}
                    expandedFolders={sidebarFolderSearch.trim() ? new Set(matchingFolderIds) : expandedFolders}
                    onToggleExpand={toggleExpand}
                    onSelectFolder={setCurrentFolderId}
                    onMoveFolder={handleMoveFolder}
                    level={0}
                    highlightIds={sidebarFolderSearch.trim() ? matchingFolderIds : undefined}
                    draggedFolderId={draggedFolderId}
                    onDragStart={setDraggedFolderId}
                    onDragEnd={() => setDraggedFolderId(null)}
                  />
                ))
              )}
            </div>
          </CardContent>
        </ScrollArea>
      </Card>

      {/* Main Content */}
      <div className="flex-1 space-y-4 overflow-auto">
        {/* Breadcrumb & Actions */}
        <Card>
          <CardContent className="p-4 space-y-4">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1 text-sm">
              <button
                onClick={() => setCurrentFolderId(null)}
                className="text-muted-foreground hover:text-foreground"
                data-testid="breadcrumb-root"
              >
                All Images
              </button>
              {breadcrumbPath.map((folder, index) => (
                <div key={folder.id} className="flex items-center gap-1">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <button
                    onClick={() => setCurrentFolderId(folder.id)}
                    className={index === breadcrumbPath.length - 1 ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}
                    data-testid={`breadcrumb-${folder.id}`}
                  >
                    {folder.name}
                  </button>
                </div>
              ))}
            </div>

            {/* Actions Row */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Label htmlFor="search" className="sr-only">Search images</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search"
                    placeholder="Search by filename..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    data-testid="input-mtp-search"
                  />
                </div>
              </div>
              <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
                <SelectTrigger className="w-[150px]" data-testid="select-file-type-filter">
                  <Filter className="h-4 w-4 mr-2 shrink-0" />
                  <SelectValue placeholder="File Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="filter-all">All Types</SelectItem>
                  {availableExtensions.map(({ ext, count }) => (
                    <SelectItem key={ext} value={ext} data-testid={`filter-${ext}`}>
                      .{ext} ({count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={aspectRatioFilter} onValueChange={setAspectRatioFilter}>
                <SelectTrigger className="w-[150px]" data-testid="select-aspect-ratio-filter">
                  <SelectValue placeholder="Ratio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="filter-ratio-all">All Ratios</SelectItem>
                  {availableAspectRatios.map(({ label, count }) => (
                    <SelectItem key={label} value={label} data-testid={`filter-ratio-${label}`}>
                      {label} ({count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2 flex-wrap">
                {currentFolder && (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" data-testid="button-folder-actions">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => copyShareLink(currentFolder)}
                          data-testid="menu-copy-share-link"
                        >
                          <Link2 className="h-4 w-4 mr-2" />
                          Copy Share Link
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setFolderToEdit(currentFolder);
                            setNewFolderName(currentFolder.name);
                            setShowRenameFolderDialog(true);
                          }}
                          data-testid="menu-rename-folder"
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setShowCreateFolderDialog(true);
                            setNewFolderName("");
                          }}
                          data-testid="menu-create-subfolder"
                        >
                          <FolderPlus className="h-4 w-4 mr-2" />
                          Create Subfolder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setFolderToMove(currentFolder);
                            setMoveFolderSearchTerm("");
                            setShowMoveFolderDialog(true);
                          }}
                          data-testid="menu-move-folder"
                        >
                          <ArrowRight className="h-4 w-4 mr-2" />
                          Move to...
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => {
                            setFolderToEdit(currentFolder);
                            setShowDeleteFolderDialog(true);
                          }}
                          data-testid="menu-delete-folder"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Folder
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
                <Button
                  variant={bulkSelectMode ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => {
                    setBulkSelectMode(!bulkSelectMode);
                    setSelectedImages(new Set());
                  }}
                  data-testid="button-bulk-select"
                >
                  {bulkSelectMode ? <X className="mr-2 h-4 w-4" /> : <CheckSquare className="mr-2 h-4 w-4" />}
                  {bulkSelectMode ? "Cancel" : "Select"}
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => handleFilesSelected(e.target.files)}
                  accept="image/*,video/*,.gif,.webp,.webm,.mp4,.mov"
                  multiple
                  className="hidden"
                  data-testid="input-mtp-upload"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  size="sm"
                  data-testid="button-mtp-upload"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {uploadProgress.total > 0 ? `${uploadProgress.current}/${uploadProgress.total}` : 'Uploading...'}
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Bulk selection actions */}
            {bulkSelectMode && (
              <div className="flex items-center gap-2 p-2 bg-muted rounded-md flex-wrap">
                <Badge variant="secondary">{selectedImages.size} selected</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllImages}
                  data-testid="button-select-all"
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSelection}
                  data-testid="button-clear-selection"
                >
                  Clear
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const urls = allImages
                      .filter(img => selectedImages.has(img.key))
                      .map(img => img.url);
                    if (urls.length === 0) return;
                    try {
                      await navigator.clipboard.writeText(urls.join('\n'));
                      toast({
                        title: "URLs Copied",
                        description: `${urls.length} URL${urls.length > 1 ? 's' : ''} copied to clipboard`,
                      });
                    } catch {
                      toast({
                        title: "Copy Failed",
                        description: "Failed to copy URLs to clipboard",
                        variant: "destructive",
                      });
                    }
                  }}
                  disabled={selectedImages.size === 0}
                  data-testid="button-copy-urls"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy URLs
                </Button>
                <Button
                  size="sm"
                  disabled={selectedImages.size === 0}
                  onClick={() => setShowMoveToFolderDialog(true)}
                  data-testid="button-move-to-folder"
                >
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Move to Folder
                </Button>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {totalImages} {fileTypeFilter !== 'all' ? `.${fileTypeFilter} ` : ''}file{totalImages !== 1 ? 's' : ''}{aspectRatioFilter !== 'all' ? ` (${aspectRatioFilter})` : ''}{(fileTypeFilter !== 'all' || aspectRatioFilter !== 'all') && totalUnfiltered !== totalImages ? ` of ${totalUnfiltered} total` : ''}{currentFolder ? ` in "${currentFolder.name}"` : ' in your MTP-Images library'}
            </p>
          </CardContent>
        </Card>

        {/* Images Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Card key={index} className="overflow-hidden">
                <CardContent className="p-0">
                  <Skeleton className="w-full aspect-square" />
                </CardContent>
                <CardContent className="p-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <div className="flex gap-2">
                    <Skeleton className="h-8 flex-1" />
                    <Skeleton className="h-8 flex-1" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isNotConfigured || imagesData?.error ? (
          <Card>
            <CardContent className="py-12 space-y-4">
              <div className="text-center">
                <p className="text-destructive font-medium mb-2">
                  {isNotConfigured ? "MTP-Images Not Configured" : "Connection Error"}
                </p>
                <p className="text-muted-foreground text-sm">
                  {imagesData?.error || "Failed to connect to Cloudflare R2."}
                </p>
                {isNotConfigured && (
                  <p className="text-muted-foreground text-sm mt-4">
                    Please ensure the following environment variables are set:
                    <br />
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">CLOUDFLARE_ACCOUNT_ID</code>,{" "}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">CLOUDFLARE_R2_ACCESS_KEY_ID</code>,{" "}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">CLOUDFLARE_R2_SECRET_ACCESS_KEY</code>
                  </p>
                )}
              </div>
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => refetch()} data-testid="button-mtp-retry">
                  Retry Connection
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-destructive">
                Failed to load images. Please check your Cloudflare R2 configuration.
              </p>
            </CardContent>
          </Card>
        ) : images.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-muted-foreground">
                {searchTerm 
                  ? `No files found matching your search${fileTypeFilter !== 'all' || aspectRatioFilter !== 'all' ? ' with the current filters' : ''}.`
                  : (fileTypeFilter !== 'all' || aspectRatioFilter !== 'all')
                    ? `No files matching the current filters${currentFolder ? ` in "${currentFolder.name}"` : ''}. Try adjusting the filters.`
                    : currentFolder 
                      ? `No files in "${currentFolder.name}" yet. Upload or move files to this folder.`
                      : "No files in your MTP-Images library yet. Upload some files to get started."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {paginatedImages.map((image) => (
                <ImageCard
                  key={image.key}
                  image={image}
                  bulkSelectMode={bulkSelectMode}
                  isSelected={selectedImages.has(image.key)}
                  copiedUrl={copiedUrl}
                  fileType={getFileType(image.key)}
                  onDimensionsLoaded={handleDimensionsLoaded}
                  onToggleSelection={() => toggleImageSelection(image.key)}
                  onCopyUrl={copyToClipboard}
                  onDelete={() => setDeleteImageKey(image.key)}
                  formatFileSize={formatFileSize}
                  getFileName={getFileName}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-4 pt-4">
                <p className="text-sm text-muted-foreground" data-testid="text-page-info">
                  Showing {(safeCurrentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(safeCurrentPage * ITEMS_PER_PAGE, totalImages)} of {totalImages} files
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safeCurrentPage <= 1}
                    onClick={() => setCurrentPage(1)}
                    data-testid="button-page-first"
                  >
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={safeCurrentPage <= 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    data-testid="button-page-prev"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {(() => {
                    const pages: number[] = [];
                    let start = Math.max(1, safeCurrentPage - 2);
                    let end = Math.min(totalPages, safeCurrentPage + 2);
                    if (end - start < 4) {
                      if (start === 1) end = Math.min(totalPages, start + 4);
                      else start = Math.max(1, end - 4);
                    }
                    for (let i = start; i <= end; i++) pages.push(i);
                    return pages.map(page => (
                      <Button
                        key={page}
                        variant={page === safeCurrentPage ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(page)}
                        data-testid={`button-page-${page}`}
                      >
                        {page}
                      </Button>
                    ));
                  })()}
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={safeCurrentPage >= totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    data-testid="button-page-next"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safeCurrentPage >= totalPages}
                    onClick={() => setCurrentPage(totalPages)}
                    data-testid="button-page-last"
                  >
                    Last
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Folder Dialog */}
      <Dialog open={showCreateFolderDialog} onOpenChange={setShowCreateFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>
              {currentFolderId ? `Create a subfolder in "${currentFolder?.name}"` : "Create a new folder to organize your images"}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="folder-name">Folder Name</Label>
            <Input
              id="folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="My Folder"
              data-testid="input-folder-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateFolderDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createFolderMutation.mutate({ name: newFolderName, parentId: currentFolderId })}
              disabled={!newFolderName.trim() || createFolderMutation.isPending}
              data-testid="button-confirm-create-folder"
            >
              {createFolderMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Folder Dialog */}
      <Dialog open={showRenameFolderDialog} onOpenChange={setShowRenameFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rename-folder-name">New Name</Label>
            <Input
              id="rename-folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              data-testid="input-rename-folder"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenameFolderDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => folderToEdit && renameFolderMutation.mutate({ id: folderToEdit.id, name: newFolderName })}
              disabled={!newFolderName.trim() || renameFolderMutation.isPending}
              data-testid="button-confirm-rename-folder"
            >
              {renameFolderMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Dialog */}
      <AlertDialog open={showDeleteFolderDialog} onOpenChange={setShowDeleteFolderDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{folderToEdit?.name}"? This will also delete all subfolders. Images will not be deleted, but they will be removed from the folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => folderToEdit && deleteFolderMutation.mutate(folderToEdit.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteFolderMutation.isPending}
              data-testid="button-confirm-delete-folder"
            >
              {deleteFolderMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move to Folder Dialog */}
      <Dialog open={showMoveToFolderDialog} onOpenChange={setShowMoveToFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Folder</DialogTitle>
            <DialogDescription>
              Select a folder to move {selectedImages.size} image(s)
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search folders..."
                value={folderSearchTerm}
                onChange={(e) => setFolderSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-folders"
              />
            </div>
            <ScrollArea className="h-64 border rounded-md">
              <div className="p-2 space-y-1">
                {filteredFolders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">No folders found</p>
                ) : (
                  filteredFolders.map(folder => (
                    <button
                      key={folder.id}
                      className="w-full flex items-center gap-2 p-2 rounded-md hover-elevate text-left"
                      onClick={() => {
                        moveImagesMutation.mutate({
                          imageKeys: Array.from(selectedImages),
                          folderId: folder.id,
                        });
                      }}
                      data-testid={`move-to-folder-${folder.id}`}
                    >
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{folder.name}</span>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveToFolderDialog(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Image Dialog */}
      <AlertDialog open={!!deleteImageKey} onOpenChange={(open) => !open && setDeleteImageKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this image? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-mtp-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteImageKey && deleteMutation.mutate(deleteImageKey)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              data-testid="button-mtp-confirm-delete"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move Folder Dialog */}
      <Dialog open={showMoveFolderDialog} onOpenChange={setShowMoveFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move Folder</DialogTitle>
            <DialogDescription>
              Select a destination for "{folderToMove?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search folders..."
                value={moveFolderSearchTerm}
                onChange={(e) => setMoveFolderSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-move-folder"
              />
            </div>
            <ScrollArea className="h-64 border rounded-md">
              <div className="p-2 space-y-1">
                {folderToMove?.parentId !== null && (
                  <button
                    className="w-full flex items-center gap-2 p-2 rounded-md hover-elevate text-left"
                    onClick={() => {
                      if (folderToMove) {
                        handleMoveFolder(folderToMove.id, null);
                        setShowMoveFolderDialog(false);
                      }
                    }}
                    data-testid="move-folder-to-root"
                  >
                    <Home className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Root (top level)</span>
                  </button>
                )}
                {folders
                  .filter(f => {
                    if (!folderToMove) return false;
                    if (f.id === folderToMove.id) return false;
                    if (f.id === folderToMove.parentId) return false;
                    if (isDescendant(folders, folderToMove.id, f.id)) return false;
                    if (moveFolderSearchTerm.trim()) {
                      return f.name.toLowerCase().includes(moveFolderSearchTerm.toLowerCase());
                    }
                    return true;
                  })
                  .map(f => (
                    <button
                      key={f.id}
                      className="w-full flex items-center gap-2 p-2 rounded-md hover-elevate text-left"
                      onClick={() => {
                        if (folderToMove) {
                          handleMoveFolder(folderToMove.id, f.id);
                          setShowMoveFolderDialog(false);
                        }
                      }}
                      data-testid={`move-folder-to-${f.id}`}
                    >
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{f.name}</span>
                    </button>
                  ))}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveFolderDialog(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StructuredFilenameDialog
        open={showUploadNamingDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowUploadNamingDialog(false);
            setPendingUploadFiles([]);
          }
        }}
        onSave={(filename, folderId) => handleUploadWithNaming(filename, folderId)}
        isPending={isUploading}
        title={`Name ${pendingUploadFiles.length} File${pendingUploadFiles.length > 1 ? 's' : ''}`}
        description={`Choose structured naming for ${pendingUploadFiles.length} file${pendingUploadFiles.length > 1 ? 's' : ''}. ${pendingUploadFiles.length > 1 ? 'Sequence numbers will auto-increment.' : ''}`}
        progress={uploadProgress.total > 0 ? uploadProgress : undefined}
      />
    </div>
  );
}
