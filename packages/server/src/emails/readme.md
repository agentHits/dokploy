# React Email Starter

A live preview right in your browser so you don't need to keep sending real emails during development.

## Getting Started

Install the dependencies with pnpm. npm and yarn ignore `pnpm-lock.yaml` and the `pnpm.overrides` entry that keeps the preview's `next` on a patched release.

```sh
npx --yes pnpm@10.22.0 install
```

Then, run the development server:

```sh
npx --yes pnpm@10.22.0 dev
```

Keep `@react-email/ui` on exactly the same version as `react-email`: the `email` CLI exits when they differ.

Open [localhost:3000](http://localhost:3000) with your browser to see the result.

## License

MIT License
