import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import HomePage from "@/pages/home";
import GeneratePage from "@/pages/generate";
import BumpGeneratorPage from "@/pages/bump-generator";
import SmsGeneratorPage from "@/pages/sms-generator";
import ImageGeneratorPage from "@/pages/image-generator";
import VideoGeneratorPage from "@/pages/video-generator-new";
import AdvertorialGeneratorPage from "@/pages/advertorial-generator";
import GifCreatorPage from "@/pages/gif-creator";
import ProductsPage from "@/pages/products";
import LibraryPage from "@/pages/library";
import ImageLibraryPage from "@/pages/image-library";
import VideoLibraryPage from "@/pages/video-library";
import AnalyticsPage from "@/pages/analytics";
import SettingsPage from "@/pages/settings";
import SharedFolderPage from "@/pages/shared-folder";
import MTPImagesPage from "@/pages/mtp-images";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/email" component={GeneratePage} />
      <Route path="/bump" component={BumpGeneratorPage} />
      <Route path="/sms" component={SmsGeneratorPage} />
      <Route path="/images" component={ImageGeneratorPage} />
      <Route path="/videos" component={VideoGeneratorPage} />
      <Route path="/advertorial" component={AdvertorialGeneratorPage} />
      <Route path="/gif-creator" component={GifCreatorPage} />
      <Route path="/products" component={ProductsPage} />
      <Route path="/library" component={LibraryPage} />
      <Route path="/image-library" component={ImageLibraryPage} />
      <Route path="/video-library" component={VideoLibraryPage} />
      <Route path="/analytics" component={AnalyticsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/shared/:shareCode" component={SharedFolderPage} />
      <Route path="/mtp-images" component={MTPImagesPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 overflow-hidden">
                <header className="flex items-center justify-between p-4 border-b gap-4">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <ThemeToggle />
                </header>
                <main className="flex-1 overflow-auto p-6">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
