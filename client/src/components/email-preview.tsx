import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Copy, Save, RotateCw, Edit } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface EmailPreviewProps {
  subjects: string[];
  body: string;
  htmlBody?: string;
  isLoading?: boolean;
  onRegenerate?: () => void;
  onSave?: () => void;
  onEdit?: () => void;
}

export function EmailPreview({
  subjects,
  body,
  htmlBody,
  isLoading,
  onRegenerate,
  onSave,
  onEdit,
}: EmailPreviewProps) {
  const [viewMode, setViewMode] = useState<"preview" | "html">("preview");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <div className="animate-spin h-12 w-12 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-muted-foreground">Generating 5 email variations...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="gap-1 space-y-0 pb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-xl">Email Preview</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              data-testid="button-edit"
            >
              <Edit className="h-3 w-3 mr-1" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              data-testid="button-copy"
            >
              <Copy className="h-3 w-3 mr-1" />
              {copied ? "Copied!" : "Copy"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRegenerate}
              data-testid="button-regenerate"
            >
              <RotateCw className="h-3 w-3 mr-1" />
              Regenerate
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 overflow-auto">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Subject Line Options:</p>
            <div className="space-y-2">
              {subjects.map((subject, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-muted rounded-md border"
                  data-testid={`subject-${idx}`}
                >
                  <p className="font-medium">{subject}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Separator />

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "preview" | "html")}>
          <TabsList className="w-full">
            <TabsTrigger value="preview" className="flex-1" data-testid="tab-preview">
              Preview
            </TabsTrigger>
            <TabsTrigger value="html" className="flex-1" data-testid="tab-html">
              HTML Code
            </TabsTrigger>
          </TabsList>
          <TabsContent value="preview" className="mt-4">
            <div
              className="bg-white p-4 rounded-md border min-h-[300px]"
              style={{
                color: '#000',
              }}
            >
              <style>{`
                .email-content a {
                  color: #0066cc !important;
                  text-decoration: underline !important;
                }
                .email-content strong {
                  font-weight: bold !important;
                }
                .email-content em {
                  font-style: italic !important;
                }
                .email-content u {
                  text-decoration: underline !important;
                }
                .email-content p {
                  margin: 0.5em 0 !important;
                }
                .email-content p:first-child {
                  margin-top: 0 !important;
                }
                .email-content p:last-child {
                  margin-bottom: 0 !important;
                }
              `}</style>
              <div
                className="email-content"
                dangerouslySetInnerHTML={{ 
                  __html: (htmlBody || body).replace(/\n/g, '<br>') 
                }}
              />
            </div>
          </TabsContent>
          <TabsContent value="html" className="mt-4">
            <div className="bg-muted p-4 rounded-md border min-h-[300px]">
              <pre className="whitespace-pre-wrap font-mono text-xs overflow-x-auto">
                {htmlBody || body}
              </pre>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-2 mt-auto pt-4 border-t flex-wrap">
          <Button onClick={onSave} className="w-full" data-testid="button-save">
            <Save className="h-4 w-4 mr-2" />
            Save to Library
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
