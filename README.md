
![DKIM Archive Logo](./public/Vector.png)

**Public archive and search engine for DKIM (DomainKeys Identified Mail) records. This is designed to help users discover, contribute, and verify email authentication keys with web UI and over API.**

## **Overview**

`archive` provides a comprehensive solution for managing DKIM records. Users can:
- **Discover DKIM public keys:** Access a searchable database of DKIM keys for various domains via a web interface and a programmatic API.
- **Contribute DKIM signatures:** Submit DKIM signatures from multiple sources, including integrated Gmail accounts or by uploading mailbox files (`.mbox`/`.pst`).
- **Verify Authenticity:** Ensure the integrity and active timeframe of DKIM keys, with records timestamped on-chain using TLSNotary for robust verification.

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

   Key variables to configure:
   - `POSTGRES_PRISMA_URL`: Your PostgreSQL connection string for Prisma.
   - `POSTGRES_URL_NON_POOLING`: Direct PostgreSQL connection string (used for migrations, etc.).
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: Credentials for Gmail OAuth integration via NextAuth.js.
   - `NEXTAUTH_URL`: The canonical URL of your deployment (e.g., `http://localhost:3000` for local development).
   - `NEXTAUTH_SECRET`: A secret key for NextAuth.js session encryption.
   - API keys or endpoint URLs for GCP Cloud Functions and other external services, if applicable.
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

The application will typically be available at [http://localhost:3000](http://localhost:3000/ "null") (or your configured port).

## **Tech Stack**

- **Framework:** [Next.js](https://nextjs.org/ "null") (with App Router)
- **Language:** [TypeScript](https://www.typescriptlang.org/ "null")
- **UI Components:** [Shadcn/ui](https://shadcn.com/ui "null")
- **Styling:** [Tailwind CSS](https://tailwindcss.com/ "null")
- **Database:** [PostgreSQL](https://www.postgresql.org/ "null")
- **ORM:** [Prisma](https://www.prisma.io/ "null")
- **Authentication:** [NextAuth.js](https://next-auth.js.org/ "null") (for Gmail integration)
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

