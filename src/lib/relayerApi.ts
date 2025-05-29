import { NextApiRequest, NextApiResponse } from "next";
import * as relayerUtils from "@zk-email/relayer-utils";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { jwt, pubkey, maxMessageLength } = req.body;

    if (!jwt || !pubkey || !maxMessageLength) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const accountCode = await relayerUtils.generateAccountCode();

    res.status(200).json(accountCode);
  } catch (error) {
    console.error("Error generating circuit inputs:", error);
    res.status(500).json({ error: "Failed to generate inputs" });
  }
}
