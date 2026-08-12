![DKIM Archive Logo](./public/Vector.png)

**Public archive and search engine for DKIM (DomainKeys Identified Mail) records. This is designed to help users discover, contribute, and verify email authentication keys with web UI and over API.**

## **Overview**

`archive` provides a comprehensive solution for managing DKIM records. Users can:

- **Discover DKIM public keys:** Access a searchable database of DKIM keys for various domains via a web interface and a programmatic API.
- **Contribute DKIM signatures:** Submit DKIM signatures from multiple sources, including integrated Gmail accounts or by uploading mailbox files (`.mbox`/`.pst`).
- **Verify Authenticity:** Ensure the integrity and active timeframe of DKIM keys, with first-seen and last-seen timestamps recorded from live DNS observation.

## **Getting Started**

These instructions will guide you through setting up the project on your local machine for development and testing.

### **Prerequisites**

- Node.js (LTS version recommended)
- `pnpm` (recommended), `npm`, or `yarn`
- A running PostgreSQL server instance
- Access to Google Cloud Platform (GCP) for Cloud Function deployment (required for full functionality)

### **Installation**

1. **Clone the repository:**
   ```
   git clone https://github.com/zkemail/archive
   cd archive
   ```
2. **Install dependencies:**

   ```
   pnpm install
   # or npm install
   # or yarn install
   ```

3. Set up environment variables:
   Copy the example environment file and customize it with your configurations:

   ```
   cp .env.example .env
   ```

   `.env.example` lists every variable the codebase reads, grouped by what it
   is for. Only one is required to get the app running:
   - `DATABASE_URL`: PostgreSQL connection string. Read by `src/lib/db.ts` and
     `prisma.config.ts`; if unset, Prisma falls back to
     `postgresql://localhost/archive`.

   The rest are per-feature and can stay empty until you need them:
   - `AUTH_GOOGLE_ID` & `AUTH_GOOGLE_SECRET` & `AUTH_SECRET`: Gmail OAuth via
     NextAuth v5. Note the `AUTH_` prefix; the older `NEXTAUTH_*` and
     `GOOGLE_CLIENT_*` names are not read.
   - `CRON_SECRET`: guards the scheduled `POST /api/batch_update` and
     `POST /api/stats` endpoints.
   - `GOOGLE_CLOUD_*`, `CLOUD_TASKS_QUEUE_NAME`, `CLOUD_FUNCTION_URL`,
     `TASKS_SERVICE_ACCOUNT_EMAIL`: the GCD key-recovery pipeline.
   - `NEXT_PUBLIC_POSTHOG_*`: analytics.

4. **Run Prisma migrations** to initialize your database schema:

   ```
   pnpm prisma migrate dev
   # or npx prisma migrate dev
   ```

5. **(Optional) Seed the database** with initial data if a seed script is available:

   ```
   pnpm prisma db seed
   # or npx prisma db seed
   ```

### **Running the Development Server**

To start the Next.js development server:

```
pnpm run dev
# or npm run dev
# or yarn dev
```

The application will typically be available at [http://localhost:3000](http://localhost:3000/ 'null') (or your configured port).

## **Tech Stack**

- **Framework:** [Next.js](https://nextjs.org/ 'null') (with App Router)
- **Language:** [TypeScript](https://www.typescriptlang.org/ 'null')
- **UI Components:** [Shadcn/ui](https://shadcn.com/ui 'null')
- **Styling:** [Tailwind CSS](https://tailwindcss.com/ 'null')
- **Database:** [PostgreSQL](https://www.postgresql.org/ 'null')
- **ORM:** [Prisma](https://www.prisma.io/ 'null')
- **Authentication:** [NextAuth.js](https://next-auth.js.org/ 'null') (for Gmail integration)
- **Serverless Functions:** GCP Cloud Functions (e.g., for Python/C++ based GCD)
- **Linting/Formatting:** ESLint, Prettier
- **Git Hooks:** Husky

## **High-Level Architecture**

The system is structured as follows:

1. **Next.js Application:**
   - **Frontend:** User interface built with React/Next.js and Shadcn/ui components.
   - **API Routes:** Backend logic handling DKIM lookups, submissions, Gmail integration, and communication with the GCP Cloud Function.
2. **Database Layer:**
   - **PostgreSQL:** Stores DKIM records, domain-selector pairs, metadata, and GCD results.
   - **Prisma:** ORM for database interactions.
3. **GCP Cloud Function:**
   - A serverless function dedicated to computationally intensive tasks, such as GCD calculations for DKIM key recovery.
