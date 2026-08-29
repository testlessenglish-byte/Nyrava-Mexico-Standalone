import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { productJsonLd, breadcrumbJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";
import { PRODUCTS, getProduct } from "@/lib/docs/product-copy";

const root = process.cwd();
const productRouteSource = readFileSync(join(root, "src", "routes", "product.$slug.tsx"), "utf8");
const docsLayoutSource = readFileSync(join(root, "src", "components", "DocsLayout.tsx"), "utf8");

describe("SEO - Product Structured Data for Nyrava Product Detail Pages", () => {
  it("defines productJsonLd helper with valid Schema.org Product structure", () => {
    expect(docsLayoutSource).toContain("export function productJsonLd");
    const jsonStr = productJsonLd("https://mexico.nyrava.com", {
      slug: "evidence-intelligence",
      title: "Evidence Intelligence",
      description: "Fact extraction and grounding from case corpus.",
      category: "Legal Technology Software",
    });

    const parsed = JSON.parse(jsonStr);
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("Product");
    expect(parsed.name).toBe("Evidence Intelligence");
    expect(parsed.description).toBe("Fact extraction and grounding from case corpus.");
    expect(parsed.url).toBe("https://mexico.nyrava.com/product/evidence-intelligence");
    expect(parsed.brand).toEqual({ "@type": "Brand", name: "Nyrava" });
    expect(parsed.category).toBe("Legal Technology Software");
    expect(parsed.aggregateRating).toBeUndefined();
    expect(parsed.review).toBeUndefined();
    expect(parsed.offers).toBeUndefined();
  });

  it("includes Product JSON-LD alongside BreadcrumbList and FAQPage in product.$slug.tsx head", () => {
    expect(productRouteSource).toContain("productJsonLd(CANONICAL_BASE");
    expect(productRouteSource).toContain("breadcrumbJsonLd(CANONICAL_BASE");
    expect(productRouteSource).toContain('"@type": "FAQPage"');
  });

  it("generates valid Product schema for every official Nyrava product/module", () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(8);
    for (const p of PRODUCTS) {
      const jsonStr = productJsonLd(CANONICAL_BASE, {
        slug: p.slug,
        title: p.title,
        description: p.description,
        category: "Legal Technology Software",
      });

      const parsed = JSON.parse(jsonStr);
      expect(parsed["@context"]).toBe("https://schema.org");
      expect(parsed["@type"]).toBe("Product");
      expect(parsed.name).toBe(p.title);
      expect(parsed.description).toBe(p.description);
      expect(parsed.url).toBe(`${CANONICAL_BASE}/product/${p.slug}`);
      expect(parsed.brand.name).toBe("Nyrava");
      expect(parsed.category).toBe("Legal Technology Software");
    }
  });

  it("handles optional image, sku, and offers accurately without injecting fake values", () => {
    const withOptional = JSON.parse(productJsonLd(CANONICAL_BASE, {
      slug: "custom-module",
      title: "Custom Module",
      description: "Custom description",
      image: "https://mexico.nyrava.com/og-image.png",
      sku: "NYR-CUSTOM-01",
      offers: {
        price: "999.00",
        priceCurrency: "MXN",
      }
    }));

    expect(withOptional.image).toBe("https://mexico.nyrava.com/og-image.png");
    expect(withOptional.sku).toBe("NYR-CUSTOM-01");
    expect(withOptional.offers).toEqual({
      "@type": "Offer",
      url: "https://mexico.nyrava.com/product/custom-module",
      price: "999.00",
      priceCurrency: "MXN",
      availability: "https://schema.org/InStock",
    });
  });
});
