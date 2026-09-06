import { useEffect, useState } from "react";
import { FiImage } from "react-icons/fi";
import Skeleton from "./Skeleton";

type ImageWithLoaderProps = {
  src: string;
  alt: string;
  /** Classes for the <img> itself — usually `h-full w-full object-cover`. */
  className?: string;
  loading?: "lazy" | "eager";
  /** Rounding for the placeholder, to follow the frame it sits in. */
  skeletonRounded?: "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";
};

/**
 * A drop-in replacement for <img> that never leaves an empty box.
 *
 * While the file downloads a themed skeleton fills the frame; when it decodes
 * the picture fades in over it; and if it fails to load a calm "no image"
 * placeholder takes its place rather than the browser's broken-image glyph.
 *
 * It positions everything absolutely, so the *parent* must be `relative` and
 * carry the size (an aspect box, a fixed height). That is already how every
 * image frame on the site is built — a `relative aspect-[…] overflow-hidden`
 * wrapper — so this slots in without changing any layout.
 *
 * Resetting on `src` change is what makes it safe inside the gallery, where one
 * element shows several photos in turn: each new source shows its own load
 * state instead of flashing the previous picture.
 */
function ImageWithLoader({
  src,
  alt,
  className = "",
  loading = "lazy",
  skeletonRounded = "none",
}: ImageWithLoaderProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );

  // A different src is a different image: show its own load state, not the
  // last one's. Cached images are caught by the ref callback below, so this
  // does not cause a flash on a photo the browser already holds.
  useEffect(() => {
    setStatus("loading");
  }, [src]);

  if (status === "error") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-sand text-charcoal-400">
        <FiImage size={22} />
        <span className="text-[10px] font-semibold uppercase tracking-wide">
          No image
        </span>
      </div>
    );
  }

  return (
    <>
      {status === "loading" && (
        <Skeleton
          rounded={skeletonRounded}
          className="absolute inset-0 h-full w-full"
        />
      )}
      <img
        // A cached image can be `complete` before React attaches a load
        // handler, so its onLoad would never fire; the ref settles that case
        // on mount without waiting.
        ref={(node) => {
          if (node?.complete && node.naturalWidth > 0) setStatus("loaded");
        }}
        src={src}
        alt={alt}
        loading={loading}
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={`${className} transition-opacity duration-500 ease-out motion-reduce:transition-none ${
          status === "loaded" ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}

export default ImageWithLoader;
