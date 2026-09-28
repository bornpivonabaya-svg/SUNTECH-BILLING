"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button, Card, Input, Label } from "@/components/ui";
import {
  LandingContent,
  DEFAULT_LANDING_CONTENT,
  fetchPublishedLandingContent,
  saveLandingContent,
  resetLandingContent,
} from "@/lib/landing-content";
import { IconCheck, IconArrowRight, IconMaintenance, IconLayers, IconSparkles } from "@/components/icons";

export default function LandingEditorPage() {
  const [content, setContent] = useState<LandingContent>(DEFAULT_LANDING_CONTENT);
  const [activeTab, setActiveTab] = useState<"hero" | "roi" | "scripts" | "pricing" | "faqs" | "footer">("hero");
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    // Loads what is actually published, not this browser's local copy — see
    // fetchPublishedLandingContent for why that distinction matters before a Save.
    void fetchPublishedLandingContent().then(setContent);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    await saveLandingContent(content);
    setIsSaving(false);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleReset = async () => {
    if (confirm("Reset all landing page text to factory defaults?")) {
      const def = await resetLandingContent();
      setContent(def);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    }
  };

  const updateFaq = (index: number, field: "q" | "a", value: string) => {
    const updated = [...content.faqs];
    updated[index] = { ...updated[index]!, [field]: value };
    setContent({ ...content, faqs: updated });
  };

  const addFaq = () => {
    setContent({
      ...content,
      faqs: [
        ...content.faqs,
        {
          q: "New Question Title",
          a: "Detailed technical answer explaining your network or billing architecture.",
        },
      ],
    });
  };

  const deleteFaq = (index: number) => {
    if (confirm("Remove this FAQ item?")) {
      setContent({
        ...content,
        faqs: content.faqs.filter((_, i) => i !== index),
      });
    }
  };

  return (
    <div className="space-y-8 max-w-6xl pb-16 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-white tracking-tight">
              Landing Page CMS &amp; Content Customizer
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-mono font-bold text-cyan-400">
              Live Backend Control
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Modify announcements, hero copy, CTAs, ROI variables, RouterOS script defaults, FAQs, and footer settings.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            target="_blank"
            className="px-3.5 py-2 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-mono text-cyan-300 font-bold transition-all flex items-center gap-1.5"
          >
            <span>View Public Page</span>
            <IconArrowRight size={13} />
          </Link>

          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-bold shadow-glow flex items-center gap-1.5"
          >
            <IconCheck size={14} />
            <span>{isSaving ? "Publishing..." : "Save & Publish"}</span>
          </Button>
        </div>
      </div>

      {savedSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in duration-200">
          <IconCheck size={16} className="text-emerald-400" />
          <span className="font-bold">
            Landing page updated successfully! Public changes are now active.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800 text-xs font-mono">
        {[
          { id: "hero", label: "Hero & Announcement" },
          { id: "pricing", label: "Pricing Plans" },
          { id: "roi", label: "ROI & Revenue Math" },
          { id: "scripts", label: "RouterOS Script Defaults" },
          { id: "faqs", label: "Technical FAQs" },
          { id: "footer", label: "Footer & Support" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3.5 py-2 rounded-xl border transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-brand-600 border-brand-500 text-white font-bold shadow-glow"
                : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Forms */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* TAB: HERO & ANNOUNCEMENT */}
        {activeTab === "hero" && (
          <div className="space-y-6">
            <Card className="p-6 space-y-4 bg-slate-900/70 border-slate-800">
              <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
                Top Announcement Pill
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <Label className="text-slate-300">Badge Tag</Label>
                  <Input
                    value={content.announcement.badge}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        announcement: { ...content.announcement, badge: e.target.value },
                      })
                    }
                    placeholder="ROUTEROS V7.14"
                    className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-slate-300">Announcement Message</Label>
                  <Input
                    value={content.announcement.text}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        announcement: { ...content.announcement, text: e.target.value },
                      })
                    }
                    placeholder="Automated WhatsApp Bot..."
                    className="mt-1 bg-slate-950 border-slate-800 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">Action Link Anchor</Label>
                  <Input
                    value={content.announcement.linkUrl}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        announcement: { ...content.announcement, linkUrl: e.target.value },
                      })
                    }
                    placeholder="#innovations"
                    className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                  />
                </div>
              </div>
            </Card>

            <Card className="p-6 space-y-4 bg-slate-900/70 border-slate-800">
              <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
                Main Hero Copy &amp; Action Buttons
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="md:col-span-3">
                  <Label className="text-slate-300">Hero Status Pill</Label>
                  <Input
                    value={content.hero.statusBadge}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        hero: { ...content.hero, statusBadge: e.target.value },
                      })
                    }
                    placeholder="Next-Gen FreeRADIUS & ISP Automation Suite"
                    className="mt-1 bg-slate-950 border-slate-800 text-white"
                  />
                </div>

                <div>
                  <Label className="text-slate-300">Heading Prefix</Label>
                  <Input
                    value={content.hero.mainHeadingStart}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        hero: { ...content.hero, mainHeadingStart: e.target.value },
                      })
                    }
                    placeholder="Automate Your ISP Billing &"
                    className="mt-1 bg-slate-950 border-slate-800 text-white font-bold"
                  />
                </div>

                <div>
                  <Label className="text-slate-300">Gradient Highlighted Word</Label>
                  <Input
                    value={content.hero.mainHeadingGradient}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        hero: { ...content.hero, mainHeadingGradient: e.target.value },
                      })
                    }
                    placeholder="MikroTik Network"
                    className="mt-1 bg-slate-950 border-cyan-800 text-cyan-300 font-bold"
                  />
                </div>

                <div>
                  <Label className="text-slate-300">Heading Suffix</Label>
                  <Input
                    value={content.hero.mainHeadingEnd}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        hero: { ...content.hero, mainHeadingEnd: e.target.value },
                      })
                    }
                    placeholder="with Zero Leakage."
                    className="mt-1 bg-slate-950 border-slate-800 text-white font-bold"
                  />
                </div>

                <div className="md:col-span-3">
                  <Label className="text-slate-300">Hero Subtitle &amp; Pitch</Label>
                  <textarea
                    rows={3}
                    value={content.hero.description}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        hero: { ...content.hero, description: e.target.value },
                      })
                    }
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-brand-500 leading-relaxed"
                  />
                </div>

                <div>
                  <Label className="text-slate-300">Primary Button Label</Label>
                  <Input
                    value={content.hero.primaryCtaText}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        hero: { ...content.hero, primaryCtaText: e.target.value },
                      })
                    }
                    className="mt-1 bg-slate-950 border-slate-800 text-white"
                  />
                </div>

                <div>
                  <Label className="text-slate-300">Primary Button URL</Label>
                  <Input
                    value={content.hero.primaryCtaUrl}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        hero: { ...content.hero, primaryCtaUrl: e.target.value },
                      })
                    }
                    className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                  />
                </div>

                <div>
                  <Label className="text-slate-300">Secondary Button Label</Label>
                  <Input
                    value={content.hero.secondaryCtaText}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        hero: { ...content.hero, secondaryCtaText: e.target.value },
                      })
                    }
                    className="mt-1 bg-slate-950 border-slate-800 text-white"
                  />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* TAB: PRICING PLANS */}
        {activeTab === "pricing" && (
          <div className="space-y-6">
            <Card className="p-6 space-y-4 bg-slate-900/70 border-slate-800">
              <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
                Pricing Section Header
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <Label className="text-slate-300">Section Title</Label>
                  <Input
                    value={content.pricing.title}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        pricing: { ...content.pricing, title: e.target.value },
                      })
                    }
                    className="mt-1 bg-slate-950 border-slate-800 text-white font-bold"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">Section Subtitle</Label>
                  <Input
                    value={content.pricing.subtitle}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        pricing: { ...content.pricing, subtitle: e.target.value },
                      })
                    }
                    className="mt-1 bg-slate-950 border-slate-800 text-white"
                  />
                </div>
              </div>
            </Card>

            <Card className="p-5 text-sm text-slate-300 bg-slate-900/80 border-slate-800">
              The prices on the website are your real plans: the ones ISPs subscribe to. Change them under{" "}
              <Link href="/plans" className="font-semibold text-brand-400 hover:underline">
                Plans
              </Link>
              .
            </Card>
          </div>
        )}

        {/* TAB: ROI & REVENUE */}
        {activeTab === "roi" && (
          <Card className="p-6 space-y-4 bg-slate-900/70 border-slate-800">
            <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
              ROI &amp; Leakage Calculator Configuration
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="md:col-span-2">
                <Label className="text-slate-300">Calculator Title</Label>
                <Input
                  value={content.roiCalculator.title}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      roiCalculator: { ...content.roiCalculator, title: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-bold"
                />
              </div>

              <div>
                <Label className="text-slate-300">Currency Symbol</Label>
                <Input
                  value={content.roiCalculator.currency}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      roiCalculator: { ...content.roiCalculator, currency: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                />
              </div>

              <div className="md:col-span-3">
                <Label className="text-slate-300">Calculator Subtitle</Label>
                <Input
                  value={content.roiCalculator.subtitle}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      roiCalculator: { ...content.roiCalculator, subtitle: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white"
                />
              </div>

              <div>
                <Label className="text-slate-300">Default Slider Subscribers</Label>
                <Input
                  type="number"
                  value={content.roiCalculator.defaultSubscribers}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      roiCalculator: {
                        ...content.roiCalculator,
                        defaultSubscribers: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                />
              </div>

              <div>
                <Label className="text-slate-300">Default ARPU (KES/mo)</Label>
                <Input
                  type="number"
                  value={content.roiCalculator.defaultArpu}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      roiCalculator: {
                        ...content.roiCalculator,
                        defaultArpu: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                />
              </div>
            </div>
          </Card>
        )}

        {/* TAB: ROUTEROS SCRIPTS */}
        {activeTab === "scripts" && (
          <Card className="p-6 space-y-4 bg-slate-900/70 border-slate-800">
            <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
              RouterOS Script Defaults
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <Label className="text-slate-300">Section Title</Label>
                <Input
                  value={content.scripts.title}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      scripts: { ...content.scripts, title: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-bold"
                />
              </div>

              <div>
                <Label className="text-slate-300">Section Subtitle</Label>
                <Input
                  value={content.scripts.subtitle}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      scripts: { ...content.scripts, subtitle: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white"
                />
              </div>

              <div>
                <Label className="text-slate-300">Default RADIUS Server Host IP</Label>
                <Input
                  value={content.scripts.defaultHost}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      scripts: { ...content.scripts, defaultHost: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                />
              </div>

              <div>
                <Label className="text-slate-300">Default Shared Secret</Label>
                <Input
                  value={content.scripts.defaultSecret}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      scripts: { ...content.scripts, defaultSecret: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                />
              </div>
            </div>
          </Card>
        )}

        {/* TAB: FAQS */}
        {activeTab === "faqs" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
                Technical FAQs ({content.faqs.length})
              </h2>
              <button
                type="button"
                onClick={addFaq}
                className="px-3 py-1.5 rounded-xl border border-brand-500/40 bg-brand-500/10 hover:bg-brand-500/20 text-brand-300 text-xs font-bold transition-all"
              >
                + Add FAQ
              </button>
            </div>

            <div className="space-y-4">
              {content.faqs.map((faq, idx) => (
                <Card key={idx} className="p-5 bg-slate-900/80 border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-mono text-slate-400">FAQ #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => deleteFaq(idx)}
                      className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 text-[11px]"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <Label className="text-slate-300">Question</Label>
                      <Input
                        value={faq.q}
                        onChange={(e) => updateFaq(idx, "q", e.target.value)}
                        className="mt-1 bg-slate-950 border-slate-800 text-white font-bold"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">Answer</Label>
                      <textarea
                        rows={3}
                        value={faq.a}
                        onChange={(e) => updateFaq(idx, "a", e.target.value)}
                        className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-brand-500 leading-relaxed"
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* TAB: FOOTER & SUPPORT */}
        {activeTab === "footer" && (
          <Card className="p-6 space-y-4 bg-slate-900/70 border-slate-800">
            <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
              Footer &amp; Support Contact Info
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="md:col-span-3">
                <Label className="text-slate-300">Footer Tagline / Overview</Label>
                <textarea
                  rows={2}
                  value={content.footer.description}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      footer: { ...content.footer, description: e.target.value },
                    })
                  }
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-brand-500 leading-relaxed"
                />
              </div>

              <div>
                <Label className="text-slate-300">Copyright Year</Label>
                <Input
                  value={content.footer.copyrightYear}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      footer: { ...content.footer, copyrightYear: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                />
              </div>

              <div>
                <Label className="text-slate-300">Support Email</Label>
                <Input
                  value={content.footer.supportEmail}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      footer: { ...content.footer, supportEmail: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                />
              </div>

              <div>
                <Label className="text-slate-300">Support Phone Number</Label>
                <Input
                  value={content.footer.supportPhone}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      footer: { ...content.footer, supportPhone: e.target.value },
                    })
                  }
                  className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                />
              </div>
            </div>
          </Card>
        )}

        {/* Footer controls */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-800">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs font-mono text-slate-500 hover:text-rose-400 transition-colors"
          >
            Reset all content to factory defaults
          </button>

          <Button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 text-xs font-bold shadow-glow flex items-center gap-2"
          >
            <IconCheck size={14} />
            <span>{isSaving ? "Saving..." : "Save and Publish Changes"}</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
