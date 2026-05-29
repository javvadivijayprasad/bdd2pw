/**
 * v3.8.0 — Retail / e-commerce domain rule pack.
 *
 * Opt-in via `ScaffoldOptions.domains: ["retail"]`. Covers the
 * common shopping-flow dialects: cart, pricing, checkout, SKUs,
 * inventory, shipping, promo codes, products, reviews, wishlist,
 * order status.
 */

import type { PageObjectIR, StepBinding, StepIR } from "../../types";

interface Rule {
  pattern: RegExp;
  build(
    m: RegExpMatchArray,
    step: StepIR,
    pom: PageObjectIR,
    pageVar: string,
  ): StepBinding | null;
}

const SUBJ = "(?:I|user|User|the user|the User|the customer|the shopper)";
const MONEY = `\\$?["']?\\$?([\\d,]+(?:\\.\\d{1,2})?)["']?`;

export const RETAIL_RULES: Rule[] = [
  // RETAIL:01 — `I add "Widget" to the cart`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?add(?:s)? ["']([^"']+)["'] to (?:the |my )?cart$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /add.*to.*cart/i }).filter({ has: page.locator(\`text=\${${JSON.stringify(m[1])}}\`) }).first().click();`,
        `// Some sites require a click on the product card first; the .filter chains it through the product context.`,
      ].join("\n"),
    }),
  },

  // RETAIL:02 — `the cart has N items`
  {
    pattern: /^(?:the )?cart has (\d+) items?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _itemCount = await page.locator("[data-testid='cart-item'], .cart-item").count();`,
        `expect(_itemCount).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // RETAIL:03 — `the cart is empty`
  {
    pattern: /^(?:the )?cart is (not )?empty$/i,
    build: (m, step) => {
      const matcher = m[1] ? "toBeGreaterThan" : "toBe";
      const expected = m[1] ? "0" : "0";
      return {
        step,
        customBody: [
          `const _cartCount = await page.locator("[data-testid='cart-item'], .cart-item").count();`,
          `expect(_cartCount).${matcher}(${expected});`,
        ].join("\n"),
      };
    },
  },

  // RETAIL:04 — `the price is "$19.99"`
  {
    pattern: new RegExp(`^(?:the )?price is ${MONEY}$`, "i"),
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='price'], .price, [itemprop='price']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // RETAIL:05 — `the subtotal is "$X"` / `the total is "$X"` / `the tax is "$X"`
  {
    pattern: new RegExp(
      `^(?:the )?(subtotal|total|tax|order total|grand total) is ${MONEY}$`,
      "i",
    ),
    build: (m, step) => {
      const kind = m[1].toLowerCase().replace(/\s+/g, "-");
      return {
        step,
        customBody: `await expect(page.locator(\`[data-testid='\${${JSON.stringify(kind)}}'], [data-testid='${kind}']\`).first()).toContainText(${JSON.stringify(m[2])});`,
      };
    },
  },

  // RETAIL:06 — `I complete the checkout`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?(?:complete(?:s)?|place(?:s)?|submit(?:s)?) (?:the )?(?:checkout|order)$`,
      "i",
    ),
    build: (_m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /(?:place|complete|submit).*order|checkout/i }).first().click();`,
      ].join("\n"),
    }),
  },

  // RETAIL:07 — `the SKU is "ABC-12345"`
  {
    pattern: /^(?:the )?SKU is ["']?([A-Z0-9-]+)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='sku'], [data-sku]").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // RETAIL:08 — `the item is "in stock"` / `"out of stock"` / `"low stock"`
  {
    pattern:
      /^(?:the )?(?:item|product) is ["']?(in stock|out of stock|low stock|backordered|sold out)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='stock-status'], .stock-status").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // RETAIL:09 — `the shipping address is "..."`
  {
    pattern: /^(?:the )?shipping address is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='shipping-address']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // RETAIL:10 — `the estimated delivery is "2026-06-01"` / "2-3 business days"
  {
    pattern: /^(?:the )?(?:estimated )?delivery(?: date)? is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='estimated-delivery'], .delivery-date").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // RETAIL:11 — `I apply promo code "SAVE10"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?(?:apply(?:ies)?|enter(?:s)?) (?:promo|discount|coupon) code ["']([^"']+)["']$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByLabel(/promo|discount|coupon/i).fill(${JSON.stringify(m[1])});`,
        `await page.getByRole("button", { name: /apply/i }).click();`,
      ].join("\n"),
    }),
  },

  // RETAIL:12 — `the discount is "$10"` / "10%"
  {
    pattern: /^(?:the )?discount is ["']?\$?([\d.]+%?)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='discount']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // RETAIL:13 — `the product name is "X"` / `the product's name is "X"` / `the product is "X"`
  {
    pattern:
      /^(?:the )?product(?:(?:'s)?\s+name)? is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='product-name'], h1[itemprop='name']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // RETAIL:14 — `the rating is N stars`
  {
    pattern: /^(?:the )?rating is (\d(?:\.\d)?)(?:\s*stars?)?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _rating = await page.locator("[data-testid='rating'], [itemprop='ratingValue']").first().innerText();`,
        `expect(Number(_rating.replace(/[^\\d.]/g, ""))).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // RETAIL:15 — `there are N reviews`
  {
    pattern: /^there (?:are|is) (\d+) reviews?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _reviewCount = await page.locator("[data-testid='review'], .review-item").count();`,
        `expect(_reviewCount).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // RETAIL:16 — `I save "X" to my wishlist`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?(?:save(?:s)?|add(?:s)?) ["']([^"']+)["'] to (?:my |the )?wishlist$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `// Find the product card by name, then click its wishlist toggle.`,
        `const _card = page.locator("[data-testid='product-card']").filter({ hasText: ${JSON.stringify(m[1])} }).first();`,
        `await _card.getByRole("button", { name: /wishlist|favorite|save/i }).click();`,
      ].join("\n"),
    }),
  },

  // RETAIL:17 — `the order status is "shipped"` / `"delivered"` / `"pending"` / `"cancelled"`
  {
    pattern: /^(?:the )?order status is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='order-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // RETAIL:18 — `the order number is "..."`
  {
    pattern: /^(?:the )?order(?: number| ID) is ["']?([A-Z0-9-]+)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='order-number']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // RETAIL:19 — `I select "Medium" size` / `I select "Red" color`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?select(?:s)? ["']([^"']+)["'] (size|color|colour|variant)$`,
      "i",
    ),
    build: (m, step) => {
      const attr = m[2].toLowerCase();
      return {
        step,
        customBody: `await page.getByRole("button", { name: new RegExp(${JSON.stringify(m[1])}, "i") }).filter({ has: page.locator(\`[data-${attr}]\`) }).first().click();`,
      };
    },
  },

  // RETAIL:20 — `I remove "X" from the cart`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?remove(?:s)? ["']([^"']+)["'] from (?:the |my )?cart$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `const _row = page.locator("[data-testid='cart-item']").filter({ hasText: ${JSON.stringify(m[1])} }).first();`,
        `await _row.getByRole("button", { name: /remove|delete/i }).click();`,
      ].join("\n"),
    }),
  },
];
