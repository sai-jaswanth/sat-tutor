import { validatePasswordStrength } from "../web/auth.js";

async function runTest() {
  console.log("Starting Phase 2.3 — Password Strength Integration Test...");

  // 1. Short password (< 8 chars)
  const shortRes = validatePasswordStrength("Sh0r!1");
  if (shortRes.valid) throw new Error("Short password should be rejected");
  if (!shortRes.errors.some(e => e.includes("8 characters"))) throw new Error("Missing length error");
  console.log("✓ Rejected short password (<8 chars).");

  // 2. Missing uppercase
  const noUpperRes = validatePasswordStrength("lowercase123!");
  if (noUpperRes.valid) throw new Error("Password missing uppercase should be rejected");
  if (!noUpperRes.errors.some(e => e.includes("uppercase"))) throw new Error("Missing uppercase error");
  console.log("✓ Rejected password missing uppercase letter.");

  // 3. Missing lowercase
  const noLowerRes = validatePasswordStrength("UPPERCASE123!");
  if (noLowerRes.valid) throw new Error("Password missing lowercase should be rejected");
  if (!noLowerRes.errors.some(e => e.includes("lowercase"))) throw new Error("Missing lowercase error");
  console.log("✓ Rejected password missing lowercase letter.");

  // 4. Missing number
  const noNumRes = validatePasswordStrength("NoNumberHere!");
  if (noNumRes.valid) throw new Error("Password missing number should be rejected");
  if (!noNumRes.errors.some(e => e.includes("number"))) throw new Error("Missing number error");
  console.log("✓ Rejected password missing number.");

  // 5. Missing special character
  const noSpecRes = validatePasswordStrength("NoSpecialChar123");
  if (noSpecRes.valid) throw new Error("Password missing special char should be rejected");
  if (!noSpecRes.errors.some(e => e.includes("special character"))) throw new Error("Missing special char error");
  console.log("✓ Rejected password missing special character.");

  // 6. Blocklisted common weak password
  const commonRes = validatePasswordStrength("password123");
  if (commonRes.valid) throw new Error("Common blocklisted password should be rejected");
  if (!commonRes.errors.some(e => e.includes("common passwords"))) throw new Error("Missing common password error");
  console.log("✓ Rejected common weak password ('password123').");

  // 7. Valid strong password
  const strongRes = validatePasswordStrength("S3cur3!P@ssw0rd2026");
  if (!strongRes.valid) throw new Error("Valid strong password was unexpectedly rejected: " + strongRes.errors.join(", "));
  if (strongRes.score < 3) throw new Error("Strong password received a low score");
  console.log("✓ Accepted valid strong password with score", strongRes.score);

  console.log("Phase 2.3 — Password Strength Integration Test PASSED successfully!\n");
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
