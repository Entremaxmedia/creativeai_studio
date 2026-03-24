import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Folder, FolderOpen, ChevronRight, ChevronDown, Home, Check, ImageIcon, Video } from "lucide-react";

interface MTPImage {
  key: string;
  size: number;
  lastModified: string;
  url: string;
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
  level: number;
}

function FolderTreeItem({ folder, folders, currentFolderId, expandedFolders, onToggleExpand, onSelectFolder, level }: FolderTreeItemProps) {
  const children = folders.filter(f => f.parentId === folder.id);
  const hasChildren = children.length > 0;
  const isExpanded = expandedFolders.has(folder.id);
  const isSelected = currentFolderId === folder.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer transition-colors ${
          isSelected ? 'bg-primary/10 text-primary' : 'hover-elevate'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onSelectFolder(folder.id)}
        data-testid={`picker-folder-${folder.id}`}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(folder.id);
            }}
            className="p-0.5 hover:bg-muted rounded"
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
          {children.map(child => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              folders={folders}
              currentFolderId={currentFolderId}
              expandedFolders={expandedFolders}
              onToggleExpand={onToggleExpand}
              onSelectFolder={onSelectFolder}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MtpImagePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (image: { url: string; key: string }) => void;
  title?: string;
  description?: string;
  fileType?: 'images' | 'videos' | 'all';
}

export default function MtpImagePicker({
  open,
  onOpenChange,
  onSelect,
  title = "Select from MTP-Images",
  description = "Browse your image library to select an image",
  fileType = 'images'
}: MtpImagePickerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<MTPImage | null>(null);

  const { data: foldersData } = useQuery<{
    success: boolean;
    folders: MTPFolder[];
  }>({
    queryKey: ['/api/mtp-folders'],
    enabled: open
  });
  
  const folders = foldersData?.folders || [];
  const rootFolders = folders.filter(f => !f.parentId);

  // Build the query URL with search, folder, and fileType parameters
  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (searchTerm) {
      params.append('search', searchTerm);
    }
    if (currentFolderId) {
      params.append('folderId', currentFolderId);
    }
    if (fileType && fileType !== 'all') {
      params.append('fileType', fileType);
    }
    const queryString = params.toString();
    return queryString ? `/api/mtp-images?${queryString}` : '/api/mtp-images';
  };

  const queryUrl = buildQueryUrl();

  const { data: imagesData, isLoading } = useQuery<{
    success: boolean;
    items: MTPImage[];
    total: number;
  }>({
    queryKey: [queryUrl],
    enabled: open
  });

  // Images are now filtered server-side via folderId param
  const filteredImages = imagesData?.items || [];

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

  const getFileName = (key: string) => {
    return key.split('/').pop() || key;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const handleSelect = () => {
    if (selectedImage) {
      onSelect({ url: selectedImage.url, key: selectedImage.key });
      setSelectedImage(null);
      setSearchTerm("");
      setCurrentFolderId(null);
      onOpenChange(false);
    }
  };

  const handleClose = () => {
    setSelectedImage(null);
    setSearchTerm("");
    setCurrentFolderId(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex gap-4 min-h-0">
          <div className="w-48 shrink-0 border rounded-md">
            <div className="p-2 border-b">
              <span className="text-sm font-medium">Folders</span>
            </div>
            <ScrollArea className="h-[calc(100%-40px)]">
              <div className="p-2">
                <div
                  className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors ${
                    currentFolderId === null ? 'bg-primary/10 text-primary' : 'hover-elevate'
                  }`}
                  onClick={() => setCurrentFolderId(null)}
                  data-testid="picker-folder-root"
                >
                  <Home className="h-4 w-4" />
                  <span className="text-sm">{fileType === 'videos' ? 'All Videos' : 'All Images'}</span>
                </div>
                {rootFolders.map(folder => (
                  <FolderTreeItem
                    key={folder.id}
                    folder={folder}
                    folders={folders}
                    currentFolderId={currentFolderId}
                    expandedFolders={expandedFolders}
                    onToggleExpand={toggleExpand}
                    onSelectFolder={setCurrentFolderId}
                    level={0}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="mb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={fileType === 'videos' ? "Search videos by name..." : "Search images by name..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-picker-search"
                />
              </div>
            </div>

            <ScrollArea className="flex-1">
              {isLoading ? (
                <div className="grid grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-md" />
                  ))}
                </div>
              ) : filteredImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  {fileType === 'videos' ? (
                    <Video className="h-12 w-12 mb-2 opacity-50" />
                  ) : (
                    <ImageIcon className="h-12 w-12 mb-2 opacity-50" />
                  )}
                  <p>No {fileType === 'videos' ? 'videos' : 'images'} found</p>
                  {searchTerm && <p className="text-sm">Try a different search term</p>}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {filteredImages.map((image) => (
                    <div
                      key={image.key}
                      className={`relative rounded-md overflow-hidden cursor-pointer border-2 transition-all ${
                        selectedImage?.key === image.key
                          ? 'border-primary ring-2 ring-primary/20'
                          : 'border-transparent hover:border-muted-foreground/30'
                      }`}
                      onClick={() => setSelectedImage(image)}
                      data-testid={`picker-image-${image.key}`}
                    >
                      {fileType === 'videos' ? (
                        <video
                          src={image.url}
                          className="w-full aspect-square object-cover bg-muted"
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          onMouseEnter={(e) => e.currentTarget.play()}
                          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                        />
                      ) : (
                        <img
                          src={image.url}
                          alt={getFileName(image.key)}
                          className="w-full aspect-square object-cover"
                          loading="lazy"
                        />
                      )}
                      {selectedImage?.key === image.key && (
                        <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                        <p className="text-xs text-white truncate">{getFileName(image.key)}</p>
                        <p className="text-xs text-white/70">{formatFileSize(image.size)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleClose} data-testid="button-picker-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleSelect}
            disabled={!selectedImage}
            data-testid="button-picker-select"
          >
            {fileType === 'videos' ? 'Select Video' : 'Select Image'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
