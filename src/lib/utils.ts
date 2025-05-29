import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ParsedEmail } from "@zk-email/sdk";
import { parseEmail as parseEmailUtils } from "@zk-email/sdk";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getSenderDomain(parsedEmail: ParsedEmail): string {
  const dkimHeader = parsedEmail.headers.get("DKIM-Signature")?.[0] || "";
  return dkimHeader.match(/d=([^;]+)/)?.[1] || "";
}

export function decodeMimeEncodedText(encodedText: string) {
  const matches = encodedText.match(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=(.*)/);
  if (!matches) return encodedText; // Return as is if no match is found

  const charset = matches[1]; // Extract the character set (e.g., UTF-8)
  const encoding = matches[2].toUpperCase(); // Encoding type: Q (Quoted-Printable) or B (Base64)
  const encodedContent = matches[3];

  if (encoding === "Q") {
    // Decode Quoted-Printable
    const decoded = encodedContent
      .replace(/_/g, " ") // Replace underscores with spaces
      .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      ); // Decode =XX to characters
    const remainingText = matches[4] ? matches[4].trim() : ""; // Capture any text after the encoded part
    return (
      new TextDecoder(charset).decode(
        new Uint8Array([...decoded].map((c) => c.charCodeAt(0)))
      ) + remainingText
    );
  } else if (encoding === "B") {
    // Decode Base64
    const decoded = atob(encodedContent); // Decode Base64
    return new TextDecoder(charset).decode(
      new Uint8Array([...decoded].map((c) => c.charCodeAt(0)))
    );
  }

  return encodedText; // Return the original text if unhandled encoding
}

export const formatDate = (timestamp: string) => {
  try {
    let date: Date;

    // Try parsing as milliseconds first
    const msTimestamp = parseInt(timestamp);

    if (!isNaN(msTimestamp) && msTimestamp.toString().length > 4) {
      date = new Date(msTimestamp);
    } else {
      date = new Date(timestamp);
    }

    if (date.toString() === "Invalid Date") {
      throw new Error("Invalid date format");
    }

    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch (error) {
    console.error("Error formatting date:", error);
    return "Invalid date";
  }
};

export async function getFileContent(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (!content) {
        return rej("File has no content");
      }
      res(content.toString());
    };
    reader.readAsText(file);
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
let relayerUtilsResolver: (value: any) => void;
const relayerUtilsInit: Promise<void> = new Promise((resolve) => {
  relayerUtilsResolver = resolve;
});

const emlPubKeyCache = new Map();

export async function parseEmail(
  eml: string,
  ignoreBodyHashCheck = false
): Promise<ParsedEmail> {
  try {
    await relayerUtilsInit;

    const publicKey = emlPubKeyCache.get(eml);

    let parsedEmail;
    if (publicKey) {
      // ignoreBodyHashCheck is not needed here, since parseEmail
      // will internally not verify the pubkey if it is provided
      parsedEmail = await parseEmailUtils(eml, publicKey);
    } else {
      console.log("parsing email no pub key");
      parsedEmail = await parseEmailUtils(eml, ignoreBodyHashCheck);
      console.log("parsed email");
      emlPubKeyCache.set(eml, parsedEmail.publicKey);

      try {
        const { senderDomain, selector } = await extractEMLDetails(
          eml,
          parsedEmail
        );

        await fetch("https://archive.zk.email/api/dsp", {
          method: "POST",
          body: JSON.stringify({
            domain: senderDomain,
            selector: selector,
          }),
        });

        // Do not stop function flow if this fails - warn only
      } catch (err) {
        console.warn("Failed to findOrCreateDSP: ", err);
      }
    }

    return parsedEmail as ParsedEmail;
  } catch (err) {
    console.error("Failed to parse email: ", err);
    throw err;
  }
}

export async function extractEMLDetails(
  emlContent: string,
  parsedEmail?: ParsedEmail,
  ignoreBodyHashCheck = false
) {
  const headers: Record<string, string> = {};
  const lines = emlContent.split("\n");

  let headerPart = true;
  const headerLines = [];

  // Parse headers
  for (const line of lines) {
    if (headerPart) {
      if (line.trim() === "") {
        headerPart = false; // End of headers
      } else {
        headerLines.push(line);
      }
    }
  }

  // Join multi-line headers and split into key-value pairs
  const joinedHeaders = headerLines
    .map((line) =>
      line.startsWith(" ") || line.startsWith("\t")
        ? line.trim()
        : `\n${line.trim()}`
    )
    .join("")
    .split("\n");

  joinedHeaders.forEach((line) => {
    const [key, ...value] = line.split(":");
    if (key) headers[key.trim()] = value.join(":").trim();
  });

  if (!parsedEmail) {
    parsedEmail = await parseEmail(emlContent, ignoreBodyHashCheck);
  }
  const emailBodyMaxLength = parsedEmail.cleanedBody.length;
  const headerLength = parsedEmail.canonicalizedHeader.length;

  const dkimHeader = parsedEmail.headers.get("DKIM-Signature")?.[0] || "";
  const selector = dkimHeader.match(/s=([^;]+)/)?.[1] || "";

  const senderDomain = getSenderDomain(parsedEmail);
  const emailQuery = `from:${senderDomain}`;

  return {
    senderDomain,
    headerLength,
    emailQuery,
    emailBodyMaxLength,
    selector,
  };
}
