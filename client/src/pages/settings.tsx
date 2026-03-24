import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw } from "lucide-react";
import { SiOpera, SiVivaldi } from "react-icons/si";

/* ── OS detection ──────────────────────────────────────────────────────────── */

function detectOS(): 'windows' | 'mac' | 'other' {
  const p = navigator.platform.toUpperCase();
  if (p.includes('WIN')) return 'windows';
  if (p.includes('MAC')) return 'mac';
  return 'other';
}

/* ── Download helpers ──────────────────────────────────────────────────────── */

function downloadExtension(browser: string) {
  const link = document.createElement('a');
  link.href = `/api/chrome-extension/download?browser=${browser}`;
  link.download = `creative-ai-${browser}-extension.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadPolicy(browser: string, os: 'windows' | 'mac') {
  const link = document.createElement('a');
  link.href = `/api/chrome-extension/policy?browser=${browser}&os=${os}`;
  const ext = os === 'windows' ? 'reg' : 'sh';
  const suffix = browser === 'chrome' ? '' : `-${browser}`;
  link.download = `${os === 'windows' ? 'windows' : 'mac'}-install${suffix}.${ext}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ── Browser logos ─────────────────────────────────────────────────────────── */

const ChromeLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <path d="M50 50 L50 10 A40 40 0 0 1 84.64 70 Z" fill="#EA4335" />
    <path d="M50 50 L84.64 70 A40 40 0 0 1 15.36 70 Z" fill="#FBBC04" />
    <path d="M50 50 L15.36 70 A40 40 0 0 1 50 10 Z" fill="#34A853" />
    <circle cx="50" cy="50" r="27" fill="white" />
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
    <path fill="url(#edgeA)" d="M50 6 C74 6 93 25 93 49 C93 73 74 92 50 92 C36 92 23 86 14 76 C20 78 28 80 36 80 C56 80 70 67 70 50 C70 39 62 30 50 30 L28 30 C20 30 14 36 14 44 C14 52 20 58 28 58 L40 58 C37 66 26 72 12 66 C6 54 7 36 16 24 C26 12 37 6 50 6 Z" />
    <path fill="url(#edgeB)" d="M50 18 C67 18 80 31 80 48 C80 58 75 66 66 71 C70 64 72 57 72 50 C72 37 62 26 50 26 C38 26 28 36 28 48 L22 48 C22 38 30 26 40 21 C43 19 46 18 50 18 Z" />
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
      <circle cx="50" cy="50" r="48" fill="url(#safariGrad)" />
      <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
      {ticks.map((deg) => {
        const rad = ((deg - 90) * Math.PI) / 180;
        const cardinal = deg % 90 === 0;
        const r1 = cardinal ? 36 : 39;
        return (
          <line key={deg}
            x1={50 + r1 * Math.cos(rad)} y1={50 + r1 * Math.sin(rad)}
            x2={50 + 44 * Math.cos(rad)} y2={50 + 44 * Math.sin(rad)}
            stroke="white" strokeWidth={cardinal ? 2.5 : 1.5} strokeLinecap="round"
          />
        );
      })}
      <polygon points="50,50 47,66 53,66" fill="#FF3B30" transform="rotate(45 50 50)" />
      <polygon points="50,50 47,34 53,34" fill="white" transform="rotate(45 50 50)" />
      <circle cx="50" cy="50" r="3.5" fill="white" />
    </svg>
  );
};

/* ── Browser config ─────────────────────────────────────────────────────────── */

type BrowserId = 'chrome' | 'edge' | 'vivaldi' | 'opera' | 'safari';

type BrowserConfig = {
  id: BrowserId;
  name: string;
  LogoComponent: React.FC<{ size?: number }>;
  panel: string;
  autoInstall: boolean;
  manualUrl: string;
  manualSteps: React.ReactNode[];
};

const BROWSERS: BrowserConfig[] = [
  {
    id: 'chrome',
    name: 'Chrome',
    LogoComponent: ChromeLogo,
    panel: 'Side Panel',
    autoInstall: true,
    manualUrl: 'chrome://extensions',
    manualSteps: [
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
    panel: 'Side Panel',
    autoInstall: true,
    manualUrl: 'edge://extensions',
    manualSteps: [
      'Download the zip and unzip it',
      <>Go to <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">edge://extensions</code></>,
      'Enable Developer Mode, click "Load unpacked"',
      'Select the unzipped folder',
    ],
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    LogoComponent: ({ size }: { size?: number }) => <SiVivaldi size={size} color="#EF3939" />,
    panel: 'Side Panel',
    autoInstall: true,
    manualUrl: 'vivaldi://extensions',
    manualSteps: [
      'Download the zip and unzip it',
      <>Go to <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">vivaldi://extensions</code></>,
      'Enable Developer Mode, click "Load unpacked"',
      'Select the unzipped folder',
    ],
  },
  {
    id: 'opera',
    name: 'Opera',
    LogoComponent: ({ size }: { size?: number }) => <SiOpera size={size} color="#FF1B2D" />,
    panel: 'Popup',
    autoInstall: false,
    manualUrl: 'opera://extensions',
    manualSteps: [
      'Download the zip and unzip it',
      <>Go to <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">opera://extensions</code></>,
      'Enable Developer Mode, click "Load unpacked"',
      'Select the unzipped folder',
    ],
  },
  {
    id: 'safari',
    name: 'Safari',
    LogoComponent: SafariLogo,
    panel: 'Popup',
    autoInstall: false,
    manualUrl: 'Safari Settings → Extensions',
    manualSteps: [
      'Download the zip and unzip it',
      <>Requires Xcode. Run: <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">xcrun safari-web-extension-converter ./creative-ai-safari</code></>,
      'Build & run in Xcode, then open Safari',
      'Go to Settings → Extensions and enable it',
    ],
  },
];

/* ── Browser card ───────────────────────────────────────────────────────────── */

function BrowserCard({ browser }: { browser: BrowserConfig }) {
  const detectedOS = detectOS();
  const defaultOS: 'windows' | 'mac' = detectedOS === 'windows' ? 'windows' : 'mac';
  const [selectedOS, setSelectedOS] = useState<'windows' | 'mac'>(defaultOS);
  const [showManual, setShowManual] = useState(false);

  const { id, name, LogoComponent, panel, autoInstall, manualSteps } = browser;

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <LogoComponent size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm leading-tight">{name}</p>
            {autoInstall && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                <RefreshCw className="w-2.5 h-2.5 mr-1" />
                Auto-updates
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-tight mt-0.5">
            Opens as: <span className="text-foreground/70">{panel}</span>
          </p>
        </div>
      </div>

      {/* Auto-install section */}
      {autoInstall ? (
        <div className="space-y-2.5">
          {/* OS toggle */}
          <div className="flex rounded-md border overflow-hidden text-xs">
            <button
              className={`flex-1 py-1 transition-colors ${selectedOS === 'windows' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setSelectedOS('windows')}
              data-testid={`button-os-windows-${id}`}
            >
              Windows
            </button>
            <button
              className={`flex-1 py-1 transition-colors ${selectedOS === 'mac' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setSelectedOS('mac')}
              data-testid={`button-os-mac-${id}`}
            >
              Mac
            </button>
          </div>

          {/* Steps */}
          <ol className="text-xs text-muted-foreground space-y-1 pl-1">
            <li>1. Click "Download install script" below</li>
            {selectedOS === 'windows' ? (
              <>
                <li>2. Double-click the downloaded <code className="font-mono bg-muted px-1 py-0.5 rounded">.reg</code> file</li>
                <li>3. Click <strong className="text-foreground/80">Yes</strong> on the prompt</li>
              </>
            ) : (
              <>
                <li>2. Open Terminal and run:</li>
                <li className="pl-2">
                  <code className="font-mono bg-muted px-1 py-0.5 rounded break-all">
                    bash ~/Downloads/mac-install{id === 'chrome' ? '' : `-${id}`}.sh
                  </code>
                </li>
                <li>3. Enter your Mac password when asked</li>
              </>
            )}
            <li>{selectedOS === 'windows' ? '4' : '4'}. Quit {name} and reopen it — extension installs automatically</li>
          </ol>

          <Button
            size="sm"
            className="gap-2 w-full"
            onClick={() => downloadPolicy(id, selectedOS)}
            data-testid={`button-policy-${id}-${selectedOS}`}
          >
            <Download className="w-3.5 h-3.5" />
            Download install script ({selectedOS === 'windows' ? 'Windows' : 'Mac'})
          </Button>

          {/* Manual toggle */}
          <button
            className="text-xs text-muted-foreground underline underline-offset-2 w-full text-center"
            onClick={() => setShowManual(v => !v)}
            data-testid={`button-toggle-manual-${id}`}
          >
            {showManual ? 'Hide' : 'Show'} manual install (no auto-updates)
          </button>

          {showManual && (
            <div className="space-y-2 pt-1 border-t">
              <ol className="text-xs text-muted-foreground space-y-1 pl-1">
                {manualSteps.map((step, i) => (
                  <li key={i}>{i + 1}. {step}</li>
                ))}
              </ol>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 w-full"
                onClick={() => downloadExtension(id)}
                data-testid={`button-download-${id}`}
              >
                <Download className="w-3.5 h-3.5" />
                Download zip for {name}
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* Manual-only install (Opera, Safari) */
        <div className="space-y-2">
          <ol className="text-xs text-muted-foreground space-y-1 pl-1">
            {manualSteps.map((step, i) => (
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
      )}
    </div>
  );
}

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
            Chrome, Edge, and Vivaldi support automatic silent updates — run the install script once and you're done.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {BROWSERS.map((browser) => (
              <BrowserCard key={browser.id} browser={browser} />
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
