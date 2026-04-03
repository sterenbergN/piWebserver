# Pi-Dashboard

A local Next.js website hosted on a Raspberry Pi for dashboard purposes.

## Prerequisites

- Raspberry Pi (any model with sufficient resources)
- Node.js installed (version 18 or later recommended)
- npm or yarn package manager

## Installation

1. Clone the repository:
    ```
    git clone <repository-url>
    cd pi-dashboard
    ```

2. Install dependencies:
    ```
    npm install
    ```

3. Build the project:
    ```
    npm run build
    ```

## Running the Application

Start the development server:
```
npm run dev
```

For production, use:
```
npm start
```

Access the dashboard at `http://localhost:3000` (or your Pi's IP address).

## Important Notes

This project uses a custom Next.js version with breaking changes. APIs, conventions, and file structure may differ from standard Next.js. Always read the relevant guide in `node_modules/next/dist/docs/` before making code changes. Heed any deprecation notices.

## Contributing

Please refer to the project guidelines for contributions.

## License

MIT Open License