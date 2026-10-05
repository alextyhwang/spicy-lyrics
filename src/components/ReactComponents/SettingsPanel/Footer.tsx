import { useStore } from "@nanostores/react";
import React from "react";
import { PerformanceForkVersion, PerformanceForkReleases } from "../../../../project/config.ts";
import { $spicyLyricsVersion } from "../../../utils/stores.ts";

interface Link {
  label: string;
  url: string;
  /** Platform tint, as an "r, g, b" triplet. Omitted for the neutral treatment. */
  brand?: string;
}

const LINKS: Link[] = [
  { label: "Website", url: "https://spicylyrics.org" },
  { label: "Discord", url: "https://discord.com/invite/uqgXU5wh8j", brand: "88, 101, 242" },
  { label: "Ko-fi", url: "https://ko-fi.com/spikerko", brand: "255, 94, 138" },
];

function ExternalArrow() {
  return (
    <svg
      className="sl-sp-footer-arrow"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2.5 7.5L7.5 2.5M7.5 2.5H3.5M7.5 2.5V6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Footer() {
  const version = useStore($spicyLyricsVersion);
  const build = `performance ${PerformanceForkVersion}`;

  return (
    <div className="sl-sp-footer">
      <div className="sl-sp-footer-links">
        {LINKS.map(({ label, url, brand }) => (
          <button
            key={label}
            type="button"
            className={`sl-sp-footer-link${brand ? " sl-sp-footer-link--brand" : ""}`}
            style={brand ? ({ "--brand": brand } as React.CSSProperties) : undefined}
            onClick={() => window.open(url, "_blank")}
          >
            <span className="sl-sp-footer-link-label">{label}</span>
            <ExternalArrow />
          </button>
        ))}
      </div>

      <div className="sl-sp-footer-meta">
        <span className="sl-sp-footer-build">
          Build: <span className="sl-sp-footer-build-value">{build}</span>
        </span>
        <div className="sl-sp-footer-brand">
          <span className="sl-sp-footer-wordmark">Spicy Lyrics</span>
          <div className="sl-sp-footer-status-row">
            <button type="button" className="sl-sp-footer-update" onClick={() => window.open(PerformanceForkReleases, "_blank", "noopener,noreferrer")}>
              Fork releases
            </button>
            <span className="sl-sp-footer-sep" aria-hidden="true">·</span>
            <span className="sl-sp-footer-version">v{version}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
