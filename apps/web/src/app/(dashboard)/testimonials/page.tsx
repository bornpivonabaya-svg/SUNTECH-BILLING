"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button, Card, Input, Label, Badge } from "@/components/ui";
import {
  TestimonialItem,
  TestimonialsConfig,
  DEFAULT_TESTIMONIALS,
  getTestimonialsConfig,
  saveTestimonialsConfig,
  resetTestimonialsConfig,
} from "@/lib/testimonials";
import { IconCheck, IconArrowRight, IconUsers, IconMessage } from "@/components/icons";

const COLOR_OPTIONS = [
  { label: "Blue", value: "bg-brand-600" },
  { label: "Emerald", value: "bg-emerald-600" },
  { label: "Indigo", value: "bg-indigo-600" },
  { label: "Cyan", value: "bg-cyan-600" },
  { label: "Purple", value: "bg-purple-600" },
  { label: "Amber", value: "bg-amber-600" },
  { label: "Rose", value: "bg-rose-600" },
];

export default function TestimonialsManagerPage() {
  const [config, setConfig] = useState<TestimonialsConfig>(DEFAULT_TESTIMONIALS);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [activePreview, setActivePreview] = useState(true);

  useEffect(() => {
    setConfig(getTestimonialsConfig());
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveTestimonialsConfig(config);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleReset = () => {
    if (confirm("Reset all testimonials to the default operator reviews?")) {
      const def = resetTestimonialsConfig();
      setConfig(def);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    }
  };

  const updateItem = (index: number, field: keyof TestimonialItem, value: any) => {
    const updated = [...config.items];
    const current = { ...updated[index]!, [field]: value };
    if (field === "name" && typeof value === "string") {
      const parts = value.trim().split(" ");
      const firstChar = parts[0]?.[0] ?? "";
      const lastChar = parts[parts.length - 1]?.[0] ?? "";
      current.initials = parts.length > 1 && firstChar && lastChar
        ? (firstChar + lastChar).toUpperCase()
        : value.slice(0, 2).toUpperCase();
    }
    updated[index] = current;
    setConfig({ ...config, items: updated });
  };

  const handleAddItem = () => {
    const newItem: TestimonialItem = {
      id: "testimonial-" + Date.now(),
      name: "New Network Operator",
      role: "Lead Engineer",
      company: "Kenya Fiber Systems",
      subscribers: "1,200 Subs",
      quote:
        "Switching to Suntech Billing automated our MikroTik PPPoE cutoffs and M-Pesa collections instantly without manual oversight.",
      initials: "NO",
      color: "bg-brand-600",
      verified: true,
    };
    setConfig({ ...config, items: [...config.items, newItem] });
  };

  const handleDeleteItem = (index: number) => {
    if (confirm("Remove this customer testimonial?")) {
      const updated = config.items.filter((_, i) => i !== index);
      setConfig({ ...config, items: updated });
    }
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= config.items.length) return;
    const updated = [...config.items];
    const temp = updated[index]!;
    updated[index] = updated[target]!;
    updated[target] = temp;
    setConfig({ ...config, items: updated });
  };

  return (
    <div className="space-y-8 max-w-6xl pb-16 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-white tracking-tight">
              Landing Page Testimonials &amp; Reviews
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-brand-500/15 border border-brand-500/30 text-[10px] font-mono font-bold text-brand-400">
              Live Customizer
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Update operator quotes, subscriber metrics, company names, and engineer credentials displayed on the public landing page.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/#testimonials"
            target="_blank"
            className="px-3.5 py-2 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-mono text-cyan-300 font-bold transition-all flex items-center gap-1.5"
          >
            <span>View on Landing Page</span>
            <IconArrowRight size={13} />
          </Link>
          <Button
            onClick={handleSave}
            className="px-4 py-2 text-xs font-bold shadow-glow flex items-center gap-1.5"
          >
            <IconCheck size={14} />
            <span>Save Testimonials</span>
          </Button>
        </div>
      </div>
      {savedSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 duration-200">
          <IconCheck size={16} className="text-emerald-400" />
          <span className="font-bold">
            Testimonials successfully updated! Changes are now live on your landing page.
          </span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSave} className="space-y-8">
        {/* Section Header Settings Card */}
        <Card className="p-6 space-y-4 bg-slate-900/70 border-slate-800">
          <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
            1. Section Header &amp; Subtitle
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div>
              <Label htmlFor="badge-text" className="text-slate-300">
                Pill Badge
              </Label>
              <Input
                id="badge-text"
                value={config.badge}
                onChange={(e) => setConfig({ ...config, badge: e.target.value })}
                placeholder="e.g. Proven in the Field"
                className="mt-1 bg-slate-950 border-slate-800 text-white"
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="title-text" className="text-slate-300">
                Main Heading
              </Label>
              <Input
                id="title-text"
                value={config.title}
                onChange={(e) => setConfig({ ...config, title: e.target.value })}
                placeholder="e.g. Trusted by network engineers across Kenya"
                className="mt-1 bg-slate-950 border-slate-800 text-white font-bold"
              />
            </div>
            <div className="md:col-span-3">
              <Label htmlFor="subtitle-text" className="text-slate-300">
                Supporting Subtitle
              </Label>
              <Input
                id="subtitle-text"
                value={config.subtitle}
                onChange={(e) => setConfig({ ...config, subtitle: e.target.value })}
                placeholder="e.g. Hear from network operators who swapped manual Excel spreadsheets..."
                className="mt-1 bg-slate-950 border-slate-800 text-white"
              />
            </div>
          </div>
        </Card>
        {/* Testimonials List Card */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
              2. Operator Testimonials ({config.items.length})
            </h2>
            <button
              type="button"
              onClick={handleAddItem}
              className="px-3 py-1.5 rounded-xl border border-brand-500/40 bg-brand-500/10 hover:bg-brand-500/20 text-brand-300 text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <span>+ Add Testimonial</span>
            </button>
          </div>
          <div className="space-y-5">
            {config.items.map((item, index) => (
              <Card
                key={item.id}
                className="p-5 bg-slate-900/80 border-slate-800 relative space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-300 font-mono text-xs font-bold">
                      #{index + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-7 w-7 rounded-full ${item.color} text-white font-bold text-xs flex items-center justify-center`}
                      >
                        {item.initials}
                      </div>
                      <span className="text-sm font-bold text-white">
                        {item.name || "Unnamed Operator"}
                      </span>
                      <span className="text-xs text-slate-400">
                        &middot; {item.company}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-mono">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMove(index, "up")}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 disabled:opacity-30"
                      title="Move Up"
                    >
                      &uarr;
                    </button>
                    <button
                      type="button"
                      disabled={index === config.items.length - 1}
                      onClick={() => handleMove(index, "down")}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 disabled:opacity-30"
                      title="Move Down"
                    >
                      &darr;
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(index)}
                      className="px-2 py-1 rounded bg-rose-950/60 border border-rose-800/60 text-rose-300 hover:bg-rose-900/60 text-[11px] ml-2"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <Label className="text-slate-300">Operator Name</Label>
                    <Input
                      value={item.name}
                      onChange={(e) => updateItem(index, "name", e.target.value)}
                      placeholder="e.g. Kevin Omondi"
                      className="mt-1 bg-slate-950 border-slate-800 text-white font-bold"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Role / Title</Label>
                    <Input
                      value={item.role}
                      onChange={(e) => updateItem(index, "role", e.target.value)}
                      placeholder="e.g. CTO"
                      className="mt-1 bg-slate-950 border-slate-800 text-white"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">ISP / Company Name</Label>
                    <Input
                      value={item.company}
                      onChange={(e) => updateItem(index, "company", e.target.value)}
                      placeholder="e.g. Nairobi Metro Fiber"
                      className="mt-1 bg-slate-950 border-slate-800 text-white"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Subscribers / Region</Label>
                    <Input
                      value={item.subscribers || ""}
                      onChange={(e) => updateItem(index, "subscribers", e.target.value)}
                      placeholder="e.g. 5,200 Subs"
                      className="mt-1 bg-slate-950 border-slate-800 text-white font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2 md:col-span-3">
                    <Label className="text-slate-300">Review / Quote</Label>
                    <textarea
                      rows={3}
                      value={item.quote}
                      onChange={(e) => updateItem(index, "quote", e.target.value)}
                      placeholder="Enter the operator's experience..."
                      className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-brand-500 leading-relaxed"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Avatar Badge Color</Label>
                    <select
                      value={item.color}
                      onChange={(e) => updateItem(index, "color", e.target.value)}
                      className="w-full mt-1 bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
                    >
                      {COLOR_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-2 mt-3 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={item.verified}
                        onChange={(e) => updateItem(index, "verified", e.target.checked)}
                        className="rounded border-slate-800 bg-slate-950 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-[11px]">Verified Operator</span>
                    </label>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
        {/* Buttons footer */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs font-mono text-slate-500 hover:text-rose-400 transition-colors"
          >
            Reset to default testimonials
          </button>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              className="px-6 py-2.5 text-xs font-bold shadow-glow flex items-center gap-2"
            >
              <IconCheck size={14} />
              <span>Save and Publish Changes</span>
            </Button>
          </div>
        </div>
      </form>
      {/* Live Preview Section */}
      <div className="border-t border-slate-800 pt-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
              3. Live Landing Page Preview
            </h3>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <span className="text-xs text-slate-500 font-mono">
            Direct real-time simulation
          </span>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-6 sm:p-10 space-y-10">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <Badge variant="info">{config.badge}</Badge>
            <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              {config.title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {config.subtitle}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {config.items.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4 flex flex-col justify-between"
              >
                <p className="text-xs text-slate-300 leading-relaxed italic">
                  &ldquo;{item.quote}&rdquo;
                </p>
                <div className="pt-3 border-t border-slate-800 flex items-center gap-3">
                  <div
                    className={`h-10 w-10 shrink-0 rounded-full ${item.color} font-bold text-white flex items-center justify-center text-sm`}
                  >
                    {item.initials}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      <span>{item.name}</span>
                      {item.verified && (
                        <span className="text-[10px] text-cyan-400 font-mono" title="Verified Network Operator">
                          ✓
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 leading-snug">
                      {item.role}, {item.company}{" "}
                      {item.subscribers && (
                        <span className="text-slate-500">({item.subscribers})</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
