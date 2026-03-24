import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Mail, CheckSquare, MessageSquare, Image, Video, FileText, Package, Library, Images, BarChart3, Settings } from "lucide-react";
import logo from "@assets/creative ai complete_1761762992378.png";

const generators = [
  {
    title: "Email Generator",
    description: "Generate 10 high-converting email variations using GPT-5 and Claude Sonnet 4",
    url: "/email",
    icon: Mail,
  },
  {
    title: "Bump Generator",
    description: "Create 10 ClickFunnels bump copy variations with optimized headlines",
    url: "/bump",
    icon: CheckSquare,
  },
  {
    title: "SMS Generator",
    description: "Generate marketing SMS/MMS campaigns with character counting and tag conversion",
    url: "/sms",
    icon: MessageSquare,
  },
  {
    title: "Image Generator",
    description: "Create marketing images using 4 AI models: GPT Image 1.5, Nano Banana Pro, Gemini 2.5, and Imagen 4",
    url: "/images",
    icon: Image,
  },
  {
    title: "Video Generator",
    description: "Generate marketing videos with Sora 2 and Veo 3 Fast with multiple generation types",
    url: "/videos",
    icon: Video,
  },
  {
    title: "Advertorial Generator",
    description: "Create full-length advertorial articles with angle generation and variations",
    url: "/advertorial",
    icon: FileText,
  },
];

const libraries = [
  {
    title: "Email Library",
    description: "Manage and track your saved email campaigns with performance metrics",
    url: "/library",
    icon: Library,
  },
  {
    title: "Image Library",
    description: "Browse and organize your saved marketing images",
    url: "/image-library",
    icon: Images,
  },
  {
    title: "Video Library",
    description: "Access your saved marketing videos with metadata and filters",
    url: "/video-library",
    icon: Video,
  },
  {
    title: "Products",
    description: "Manage products and offers for campaign generation",
    url: "/products",
    icon: Package,
  },
];

const analytics = [
  {
    title: "Email Analytics",
    description: "Track performance metrics, win rates, and AI insights across campaigns",
    url: "/analytics",
    icon: BarChart3,
  },
  {
    title: "Settings",
    description: "Configure your app preferences and settings",
    url: "/settings",
    icon: Settings,
  },
];

export default function HomePage() {
  return (
    <div className="max-w-7xl mx-auto space-y-12">
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <img 
            src={logo} 
            alt="Entremax Creative AI" 
            className="h-48 w-auto"
            data-testid="img-logo"
          />
        </div>
        
        <div className="space-y-3">
          <h1 className="text-4xl font-bold text-foreground" data-testid="text-title">
            Welcome to Entremax Creative AI
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto" data-testid="text-description">
            Your AI-powered marketing campaign generator designed to create high-converting emails, images, videos, bump copy, SMS/MMS campaigns, and advertorial content. Streamline content creation, enable A/B testing, and track performance metrics to boost conversion rates.
          </p>
        </div>
      </div>

      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-2" data-testid="text-generators-heading">
            Generators
          </h2>
          <p className="text-muted-foreground" data-testid="text-generators-subheading">
            Create AI-powered marketing content across multiple formats
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {generators.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.url} href={item.url}>
                <Card 
                  className="hover-elevate active-elevate-2 cursor-pointer transition-all h-full"
                  data-testid={`card-generator-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <CardHeader className="gap-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-lg">{item.title}</CardTitle>
                    </div>
                    <CardDescription className="text-sm">
                      {item.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-2" data-testid="text-libraries-heading">
            Libraries
          </h2>
          <p className="text-muted-foreground" data-testid="text-libraries-subheading">
            Manage and organize your saved marketing assets
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {libraries.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.url} href={item.url}>
                <Card 
                  className="hover-elevate active-elevate-2 cursor-pointer transition-all h-full"
                  data-testid={`card-library-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <CardHeader className="gap-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-lg">{item.title}</CardTitle>
                    </div>
                    <CardDescription className="text-sm">
                      {item.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="space-y-6 pb-12">
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-2" data-testid="text-analytics-heading">
            Email Analytics & Settings
          </h2>
          <p className="text-muted-foreground" data-testid="text-analytics-subheading">
            Track performance and configure your experience
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {analytics.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.url} href={item.url}>
                <Card 
                  className="hover-elevate active-elevate-2 cursor-pointer transition-all h-full"
                  data-testid={`card-analytics-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <CardHeader className="gap-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-lg">{item.title}</CardTitle>
                    </div>
                    <CardDescription className="text-sm">
                      {item.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
