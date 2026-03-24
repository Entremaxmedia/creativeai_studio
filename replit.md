# Entremax Creative AI

## Overview
Entremax Creative AI is an AI-powered platform designed to assist marketers in generating high-converting marketing campaign content. This includes various content types like email variations, bump copy, SMS/MMS campaigns, marketing images, marketing videos, and advertorials. The platform's core purpose is to streamline content creation, facilitate A/B testing, and track performance to boost conversion rates for product promotions by leveraging advanced AI models to create diverse and effective marketing assets.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is built with React and TypeScript, utilizing Vite for tooling, shadcn/ui (based on Radix UI) for UI components, Tailwind CSS for styling, and wouter for routing. State management combines React Query for server state and React hooks for local component state. The design system features a purple-centric color palette, status-based color coding, and uses Inter and JetBrains Mono fonts.

### Backend
The backend is an Express.js (Node.js) application providing RESTful APIs. It manages various content types (product, email, bump, SMS, image, video) and analytics. It uses a session-based architecture and integrates with multiple AI services, including OpenAI (GPT-5, DALL-E 3), Claude Sonnet 4, Gemini (Imagen 4, Veo), and Nano Banana Pro & Nano Banana 2 via kie.ai.

### Data Storage
The primary data store is a PostgreSQL database managed with Drizzle ORM for type-safe queries. It stores product and email campaign data, including performance metrics and edit history. Generated video and image assets are stored in cloud storage, with metadata cached locally for persistence and on-demand retrieval.

### System Design Choices
The platform employs a multi-AI generation strategy, making parallel API calls to various models to produce diverse outputs. It includes automatic fallback mechanisms to ensure reliability despite rate limits. An AI learning loop analyzes winning campaign data to refine future content generation. Content generation features tone control, product-specific context, multiple variations, and strict formatting. Analytics track win rates by tone, offer type, and overall performance, providing real-time updates and AI insights.

### Key Features
-   **Generators**: Modules for generating Email, Bump, SMS, Image, Video, and Advertorial content, each leveraging specific AI models and offering multiple variations, tone control, and product-specific context.
-   **Libraries**: Centralized management for generated Emails, Images, and Videos, including editing, status tracking, search, filtering, and deep linking. Product management includes robust pagination and filtering.
-   **Advanced Generation Features**:
    -   **SMS Generator**: Generates SMS/MMS campaigns with brand selection, searchable offer selection, real-time character counting, tag conversion for personalization, and strict formatting.
    -   **Image Generator**: Features Standard Generator (multi-AI generation with reference images, AI-powered prompt suggestions), Mass Image Generator (batch generation for up to 15 prompts with parallel processing and real-time progress), and Image Prompt Helper (uses Claude Sonnet 4 vision for detailed, AI-optimized prompt generation). Image Editor supports client-side processing for static images and server-side processing (ImageMagick) for animated GIFs. Mass Image Editor supports batch resizing with percentage-based or aspect-ratio-based sizing (square, portrait, landscape, standard presets with auto-linked width/height fields), batch download, and bulk MTP-Images upload with auto-incrementing sequences and collision detection. MTP-Images uses structured naming convention: `{category}-{productid}-{type}-{sequence}` or `{category}-{productid}-{type}-{variant}-{sequence}` with auto-incrementing sequence numbers.
    -   **GIF Creator**: Visual editor for converting videos to GIF/WebP with interactive crop overlay (double-click to enter crop mode, 8 draggable handles, rule-of-thirds grid, dark overlay outside crop region) and visual timeline (playhead scrubbing, draggable trim handles for in/out points, trim at playhead via S key or scissors button, zoom controls). Supports upload, MTP library, and saved video sources with chunked upload for large files. Settings include quality, FPS, and scale with estimated file sizes. Outputs both GIF and WebP simultaneously via server-side FFmpeg with MTP-Images upload support.
    -   **Video Generator**: Offers user-controlled multi-model AI selection (Sora, Veo variants), diverse generation types (text-to-video, image-to-video, video-extension), configurable video length and aspect ratios. Includes AI-powered video prompt suggestions and intelligent rate limit management.
    -   **Advertorial Generator**: A two-step process generating angles, then full articles (400-800 words) with multiple variations and HTML formatting.
-   **Analytics**: Tracks win rates segmented by tone, offer type, and overall performance, with visual charts and AI insights.

## External Dependencies
-   **AI Services**: OpenAI API (GPT-5, DALL-E 3, Sora 2 Pro & Sora 2 via kie.ai), Claude Sonnet 4, Gemini (Imagen 4, Veo 3/Veo 3 Fast/Veo 2), kie.ai (Veo 3.1/Veo 3.1 Fast, Nano Banana Pro, Nano Banana 2)
-   **Database**: Neon Serverless PostgreSQL
-   **UI/UX Libraries**: Radix UI, Tailwind CSS, shadcn/ui, Recharts
-   **Frameworks/Tools**: React, TypeScript, Vite, Express.js, Node.js, Drizzle ORM, React Query, wouter, date-fns, zod, React Hook Form, multer, @fal-ai/client, heic-convert
-   **Fonts**: Google Fonts (Inter, JetBrains Mono)