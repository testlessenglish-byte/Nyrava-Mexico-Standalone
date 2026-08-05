// Shared React Email styles for Nyrava Intelligence México
// Email Body background must stay #ffffff per deliverability best practice.

export const colors = {
  background: "#ffffff",
  surface: "#F5F1E6",
  foreground: "#16241d",
  muted: "#5c6b62",
  primary: "#D8B36A",
  primaryForeground: "#16241d",
  border: "rgba(22,36,29,0.12)",
  footer: "#7a857d",
};

export const main = {
  backgroundColor: colors.background,
  fontFamily: '"Inter", Arial, sans-serif',
};

export const wrapper = {
  backgroundColor: colors.surface,
  padding: "32px 20px",
};

export const container = {
  backgroundColor: colors.background,
  borderRadius: "8px",
  border: `1px solid ${colors.border}`,
  padding: "32px",
  maxWidth: "480px",
};

export const logoRow = {
  marginBottom: "24px",
};

export const logoImg = {
  height: "40px",
  width: "auto",
};

export const h1 = {
  fontSize: "22px",
  fontWeight: "bold" as const,
  color: colors.foreground,
  margin: "0 0 20px",
  lineHeight: "1.3",
};

export const text = {
  fontSize: "14px",
  color: colors.foreground,
  lineHeight: "1.6",
  margin: "0 0 20px",
};

export const mutedText = {
  fontSize: "14px",
  color: colors.muted,
  lineHeight: "1.6",
  margin: "0 0 20px",
};

export const link = {
  color: colors.primaryForeground,
  textDecoration: "underline",
  fontWeight: "500" as const,
};

export const button = {
  backgroundColor: colors.primary,
  color: colors.primaryForeground,
  fontSize: "14px",
  fontWeight: "600" as const,
  borderRadius: "6px",
  padding: "12px 24px",
  textDecoration: "none",
  display: "inline-block",
};

export const codeStyle = {
  fontFamily: '"JetBrains Mono", Courier, monospace',
  fontSize: "28px",
  fontWeight: "bold" as const,
  letterSpacing: "4px",
  color: colors.foreground,
  backgroundColor: colors.surface,
  padding: "14px 20px",
  borderRadius: "6px",
  margin: "0 0 24px",
};

export const footer = {
  fontSize: "12px",
  color: colors.footer,
  margin: "28px 0 0",
  lineHeight: "1.5",
};

export const siteName = "Nyrava Intelligence México";
export const logoUrl =
  "https://mexico.nyrava.com/__l5e/assets-v1/f790a1b1-bc41-4ae1-81ab-30a4c5a0fa46/nyrava-shield.png";
