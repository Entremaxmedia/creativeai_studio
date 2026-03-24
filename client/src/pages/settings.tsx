import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Download } from "lucide-react";
import { SiOpera, SiVivaldi } from "react-icons/si";

function downloadExtension(browser: string) {
  const link = document.createElement('a');
  link.href = `/api/chrome-extension/download?browser=${browser}`;
  link.download = `creative-ai-${browser}-extension.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ── Multi-color browser logos ─────────────────────────────────────────────── */

const ChromeLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    {/* Red segment: center → top → clockwise 120° → lower-right */}
    <path d="M50 50 L50 10 A40 40 0 0 1 84.64 70 Z" fill="#EA4335" />
    {/* Yellow segment: center → lower-right → clockwise 120° → lower-left */}
    <path d="M50 50 L84.64 70 A40 40 0 0 1 15.36 70 Z" fill="#FBBC04" />
    {/* Green segment: center → lower-left → clockwise 120° → top */}
    <path d="M50 50 L15.36 70 A40 40 0 0 1 50 10 Z" fill="#34A853" />
    {/* White donut ring */}
    <circle cx="50" cy="50" r="27" fill="white" />
    {/* Blue center */}
    <circle cx="50" cy="50" r="18" fill="#4285F4" />
  </svg>
);

const EdgeLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <linearGradient id="edgeA" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#50E6FF" />
        <stop offset="100%" stopColor="#0078D4" />
      </linearGradient>
      <linearGradient id="edgeB" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#0A6CBF" />
        <stop offset="100%" stopColor="#004FA3" />
      </linearGradient>
    </defs>
    {/* Main wave body */}
    <path fill="url(#edgeA)" d="
      M50 6
      C74 6 93 25 93 49
      C93 73 74 92 50 92
      C36 92 23 86 14 76
      C20 78 28 80 36 80
      C56 80 70 67 70 50
      C70 39 62 30 50 30
      L28 30
      C20 30 14 36 14 44
      C14 52 20 58 28 58
      L40 58
      C37 66 26 72 12 66
      C6 54 7 36 16 24
      C26 12 37 6 50 6 Z
    " />
    {/* Inner darker wave to create the 'e' cutout effect */}
    <path fill="url(#edgeB)" d="
      M50 18
      C67 18 80 31 80 48
      C80 58 75 66 66 71
      C70 64 72 57 72 50
      C72 37 62 26 50 26
      C38 26 28 36 28 48
      L22 48
      C22 38 30 26 40 21
      C43 19 46 18 50 18 Z
    " />
  </svg>
);

const SafariLogo = ({ size = 28 }: { size?: number }) => {
  const ticks = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id="safariGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#55BAFD" />
          <stop offset="100%" stopColor="#1476F2" />
        </linearGradient>
      </defs>
      {/* Background circle */}
      <circle cx="50" cy="50" r="48" fill="url(#safariGrad)" />
      <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
      {/* Compass tick marks */}
      {ticks.map((deg) => {
        const rad = ((deg - 90) * Math.PI) / 180;
        const cardinal = deg % 90 === 0;
        const r1 = cardinal ? 36 : 39;
        return (
          <line
            key={deg}
            x1={50 + r1 * Math.cos(rad)} y1={50 + r1 * Math.sin(rad)}
            x2={50 + 44 * Math.cos(rad)} y2={50 + 44 * Math.sin(rad)}
            stroke="white" strokeWidth={cardinal ? 2.5 : 1.5} strokeLinecap="round"
          />
        );
      })}
      {/* Red needle (NE — rotated 45°) */}
      <polygon points="50,50 47,66 53,66" fill="#FF3B30" transform="rotate(45 50 50)" />
      {/* White needle (SW — opposite) */}
      <polygon points="50,50 47,34 53,34" fill="white" transform="rotate(45 50 50)" />
      {/* Center pivot */}
      <circle cx="50" cy="50" r="3.5" fill="white" />
    </svg>
  );
};

/* ── Browser config ─────────────────────────────────────────────────────────── */

const BROWSERS = [
  {
    id: 'chrome',
    name: 'Chrome',
    LogoComponent: ChromeLogo,
    extensionsUrl: 'chrome://extensions',
    panel: 'Side Panel',
    steps: [
      'Download the zip and unzip it',
      <>Go to <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">chrome://extensions</code></>,
      'Enable Developer Mode, click "Load unpacked"',
      'Select the unzipped folder',
    ],
  },
  {
    id: 'edge',
    name: 'Edge',
    LogoComponent: EdgeLogo,
    extensionsUrl: 'edge://extensions',
    panel: 'Side Panel',
    steps: [
      'Download the zip and unzip it',
      <>Go to <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">edge://extensions</code></>,
      'Enable Developer Mode, click "Load unpacked"',
      'Select the unzipped folder',
    ],
  },
  {
    id: 'opera',
    name: 'Opera',
    LogoComponent: ({ size }: { size?: number }) => <SiOpera size={size} color="#FF1B2D" />,
    extensionsUrl: 'opera://extensions',
    panel: 'Popup',
    steps: [
      'Download the zip and unzip it',
      <>Go to <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">opera://extensions</code></>,
      'Enable Developer Mode, click "Load unpacked"',
      'Select the unzipped folder',
    ],
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    LogoComponent: ({ size }: { size?: number }) => <SiVivaldi size={size} color="#EF3939" />,
    extensionsUrl: 'vivaldi://extensions',
    panel: 'Side Panel',
    steps: [
      'Download the zip and unzip it',
      <>Go to <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">vivaldi://extensions</code></>,
      'Enable Developer Mode, click "Load unpacked"',
      'Select the unzipped folder',
    ],
  },
  {
    id: 'safari',
    name: 'Safari',
    LogoComponent: SafariLogo,
    extensionsUrl: 'Safari Settings → Extensions',
    panel: 'Popup',
    steps: [
      'Download the zip and unzip it',
      <>Requires Xcode on Mac. Run: <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">xcrun safari-web-extension-converter ./creative-ai-safari</code></>,
      'Build & run in Xcode, then open Safari',
      'Go to Settings → Extensions and enable it',
    ],
  },
] as const;

/* ── Page ───────────────────────────────────────────────────────────────────── */

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your email generator preferences
        </p>
      </div>

      <Card>
        <CardHeader className="gap-1 space-y-0 pb-4">
          <CardTitle>AI Configuration</CardTitle>
          <CardDescription>Adjust how the AI generates email content</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Learning Mode</Label>
              <p className="text-sm text-muted-foreground">Use feedback to improve future generations</p>
            </div>
            <Switch defaultChecked data-testid="switch-learning" />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-save Generated Emails</Label>
              <p className="text-sm text-muted-foreground">Automatically save all generated emails to library</p>
            </div>
            <Switch defaultChecked data-testid="switch-autosave" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1 space-y-0 pb-4">
          <CardTitle>Brand Settings</CardTitle>
          <CardDescription>Configure your brand voice and defaults</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Brand Name</Label>
            <Input id="brand-name" placeholder="Your Company Name" defaultValue="Entremax Creative AI" data-testid="input-brand-name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default-tone">Default Tone</Label>
            <Input id="default-tone" placeholder="Professional" defaultValue="Professional" data-testid="input-default-tone" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signature">Email Signature</Label>
            <Input id="signature" placeholder="Best regards, Your Team" defaultValue="Best regards, Your Team" data-testid="input-signature" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1 space-y-0 pb-4">
          <CardTitle>Browser Extension</CardTitle>
          <CardDescription>
            Scrape and import images &amp; videos from any webpage directly into your MTP-Images library.
            Download the version for your browser and follow the steps below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {BROWSERS.map(({ id, name, LogoComponent, panel, steps }) => (
              <div key={id} className="flex flex-col gap-3 rounded-md border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <LogoComponent size={28} />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-tight">{name}</p>
                    <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                      Opens as: <span className="text-foreground/70">{panel}</span>
                    </p>
                  </div>
                </div>
                <ol className="text-xs text-muted-foreground space-y-1 pl-1">
                  {steps.map((step, i) => (
                    <li key={i}>{i + 1}. {step}</li>
                  ))}
                </ol>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 w-full mt-auto"
                  onClick={() => downloadExtension(id)}
                  data-testid={`button-download-${id}`}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download for {name}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1 space-y-0 pb-4">
          <CardTitle>Data Management</CardTitle>
          <CardDescription>Manage your data and reset settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" data-testid="button-export">Export All Data</Button>
          <Separator />
          <div className="space-y-2">
            <Button variant="destructive" data-testid="button-clear">Clear All Email History</Button>
            <p className="text-xs text-muted-foreground">
              This will permanently delete all saved emails. This action cannot be undone.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
