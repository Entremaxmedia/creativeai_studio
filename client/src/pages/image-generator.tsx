import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StandardImageGenerator from "@/components/image-generator/standard-generator";
import MassImageGenerator from "@/components/image-generator/mass-generator";
import ImagePromptHelper from "@/components/image-generator/prompt-helper";
import ImageEditor from "@/components/image-generator/image-editor";
import MassImageEditor from "@/components/image-generator/mass-image-editor";

export default function ImageGeneratorPage() {
  const [activeTab, setActiveTab] = useState("standard");

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="border-b px-4 sm:px-6">
          <TabsList className="h-12 bg-transparent">
            <TabsTrigger 
              value="standard" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-standard"
            >
              Standard Generator
            </TabsTrigger>
            <TabsTrigger 
              value="mass" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-mass"
            >
              Mass Generator
            </TabsTrigger>
            <TabsTrigger 
              value="helper" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-helper"
            >
              Prompt Helper
            </TabsTrigger>
            <TabsTrigger 
              value="editor" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-editor"
            >
              Image Editor
            </TabsTrigger>
            <TabsTrigger 
              value="mass-editor" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-mass-editor"
            >
              Mass Editor
            </TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="standard" className="flex-1 overflow-auto mt-0">
          <StandardImageGenerator />
        </TabsContent>
        
        <TabsContent value="mass" className="flex-1 overflow-auto mt-0">
          <MassImageGenerator />
        </TabsContent>
        
        <TabsContent value="helper" className="flex-1 overflow-auto mt-0">
          <ImagePromptHelper onSwitchToMassGenerator={() => setActiveTab("mass")} />
        </TabsContent>
        
        <TabsContent value="editor" className="flex-1 overflow-auto mt-0">
          <ImageEditor />
        </TabsContent>
        
        <TabsContent value="mass-editor" className="flex-1 overflow-auto mt-0">
          <MassImageEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
