import { Mail, Package, Library, BarChart3, Settings, CheckSquare, Image, Images, FileText, MessageSquare, Video, Home, Film } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import logo from "@assets/creative ai complete_1761762992378.png";

const menuItems = [
  {
    title: "Home",
    url: "/",
    icon: Home,
  },
  {
    title: "Email Generator",
    url: "/email",
    icon: Mail,
  },
  {
    title: "Bump Generator",
    url: "/bump",
    icon: CheckSquare,
  },
  {
    title: "SMS Generator",
    url: "/sms",
    icon: MessageSquare,
  },
  {
    title: "Image Center",
    url: "/images",
    icon: Image,
  },
  {
    title: "Video Generator",
    url: "/videos",
    icon: Video,
  },
  {
    title: "Advertorial Generator",
    url: "/advertorial",
    icon: FileText,
  },
  {
    title: "GIF Creator",
    url: "/gif-creator",
    icon: Film,
  },
  {
    title: "Products",
    url: "/products",
    icon: Package,
  },
  {
    title: "Email Library",
    url: "/library",
    icon: Library,
  },
  {
    title: "Image Library",
    url: "/image-library",
    icon: Images,
  },
  {
    title: "Video Library",
    url: "/video-library",
    icon: Video,
  },
  {
    title: "MTP-Images",
    url: "/mtp-images",
    icon: Images,
  },
  {
    title: "Email Analytics",
    url: "/analytics",
    icon: BarChart3,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 pt-8 pb-8 mb-10 mt-6 flex items-center justify-center">
            <img 
              src={logo} 
              alt="Entremax Creative AI" 
              className="h-36 w-auto object-contain"
            />
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
