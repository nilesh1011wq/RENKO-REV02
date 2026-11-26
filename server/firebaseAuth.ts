import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Request } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BOOTSTRAP_ADMIN_EMAIL = 'parimandape@gmail.com';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadProjectId(): string {
  const configPath = path.resolve(__dirname, '..', 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as FirebaseAppletConfig;
  if (!parsed.projectId) {
    throw new Error('Missing projectId in firebase-applet-config.json');
  }
  return parsed.projectId;
}

const projectId = loadProjectId();

// Starter Tier safe initialization: projectId only, no service account / IAM required for verifyIdToken.
const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      projectId,
    });

export interface AuthenticatedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  isBootstrapAdmin: boolean;
}

export async function verifyRequestAuth(
  req: Request,
): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token.length > 8192) {
    return null;
  }

  try {
    // Do NOT pass checkRevoked=true (that requires IAM permissions unavailable on Starter Tier)
    const decoded = await getAuth(adminApp).verifyIdToken(token);
    const email = typeof decoded.email === 'string' ? decoded.email : '';
    const emailVerified = decoded.email_verified === true;

    if (!decoded.uid || !email || !emailVerified) {
      return null;
    }

    return {
      uid: decoded.uid,
      email,
      emailVerified,
      displayName:
        typeof decoded.name === 'string' && decoded.name.trim()
          ? decoded.name.trim()
          : email.split('@')[0],
      isBootstrapAdmin: email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL,
    };
  } catch {
    return null;
  }
}
