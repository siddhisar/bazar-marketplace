import { useEffect, useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import ImageWithLoader from "../common/ImageWithLoader";

type ListingGalleryProps = {
  images: string[];
  alt: string;
};

/**
 * Photo gallery for a listing page: one large image, thumbnails, and previous
 * and next controls.
 *
 * Wraps at both ends rather than disabling the arrows — a small set of photos is
 * something people flick through repeatedly, and a dead button at the end
 * interrupts that.
 */
function ListingGallery({ images, alt }: ListingGalleryProps) {
  const [active, setActive] = useState(0);

  // A different listing means a different gallery; start at its first photo.
  useEffect(() => setActive(0), [images]);

  if (images.length === 0) return null;

  const step = (direction: 1 | -1) =>
    setActive((current) => (current + direction + images.length) % images.length);

  const arrow =
    "absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-r from-cyan-50/95 to-mint-50/95 text-charcoal-700 shadow-md transition hover:scale-105";

  return (
    <div>
      {/* Capped height on wider screens — at `aspect-[4/3]` alone, the wide
          left column of the desktop layout stretched this well past
          400-500px tall and made the whole page feel unnecessarily long.
          The cap only kicks in once the column is wide enough for that to
          matter; a phone-width column stays governed by the aspect ratio
          alone, same as before. `object-cover` on the image is what lets
          the box be shorter than its own aspect ratio would imply without
          distorting the photo. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-taupe bg-sand sm:max-h-[360px] lg:max-h-[400px]">
        <ImageWithLoader
          src={images[active]}
          alt={alt}
          loading="eager"
          skeletonRounded="2xl"
          className="h-full w-full object-cover"
        />

        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous photo"
              className={`${arrow} left-3`}
            >
              <FiChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next photo"
              className={`${arrow} right-3`}
            >
              <FiChevronRight size={18} />
            </button>

            <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
              {active + 1} / {images.length}
            </span>
          </>
        )}
      </div>

      {images.length > 1 && (
        /* Scrolls horizontally rather than wrapping, so the main image never
           gets pushed off screen by a long strip of thumbnails. */
        <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {images.map((src, index) => (
            <button
              key={`${src}-${index}`}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`View photo ${index + 1}`}
              aria-pressed={active === index}
              className={`relative h-16 w-20 flex-shrink-0 overflow-hidden rounded-xl border-2 bg-sand transition ${
                active === index
                  ? "border-cyan-500"
                  : "border-transparent hover:border-taupe"
              }`}
            >
              <ImageWithLoader
                src={src}
                alt=""
                skeletonRounded="lg"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ListingGallery;
