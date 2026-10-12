import { Component } from '@theme/component';
import { SlideshowSelectEvent, ThemeEvents, ZoomMediaSelectedEvent } from '@theme/events';
import { StandardEvents, ProductSelectEvent } from '@shopify/events';

/**
 * A custom element that renders a media gallery.
 *
 * @typedef {object} Refs
 * @property {import('./zoom-dialog').ZoomDialog} [zoomDialogComponent] - The zoom dialog component.
 * @property {import('./slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {HTMLElement[]} [media] - The media elements.
 *
 * @extends Component<Refs>
 */
export class MediaGallery extends Component {
  #controller;

  connectedCallback() {
    super.connectedCallback();

    this.#controller?.abort();
    this.#controller = new AbortController();
    const { signal } = this.#controller;
    const target = this.closest('.shopify-section, dialog');

    target?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect, { signal });
    document.addEventListener('shopify:section:load', this.#handleSectionLoad, { signal });
    this.addEventListener(SlideshowSelectEvent.eventName, this.#handleSlideshowSelected, { signal });
    this.refs.zoomDialogComponent?.addEventListener(ThemeEvents.zoomMediaSelected, this.#handleZoomMediaSelected, {
      signal,
    });
    this.#applyColorFilter(this.dataset.selectedColor);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#controller?.abort();
  }

  /**
   * Handles a product select event by replacing the current media gallery with a new one.
   *
   * @param {ProductSelectEvent} event - The product select event.
   */
  #handleProductSelect = (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card')) return;

    const selectedColor = event.selectedOptions.find((option) => isColorOption(option.name))?.value;
    this.dataset.selectedColor = handleizeColor(selectedColor ?? '');
    this.#applyColorFilter(this.dataset.selectedColor);

    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html } = detail;
        const newMediaGallery = html.querySelector('media-gallery');
        if (!newMediaGallery) return;

        this.replaceWith(newMediaGallery);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[media-gallery] Event promise rejected:', error);
      });
  };

  #handleSectionLoad = (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.contains(this)) return;

    this.#applyColorFilter(this.dataset.selectedColor);
  };

  /**
   * Applies the selected color to each rendered copy of the product media.
   * @param {string | undefined} selectedColor - The handleized Color option value.
   */
  #applyColorFilter(selectedColor) {
    const hasColorOption = this.dataset.hasColorOption === 'true';
    const colorKey = hasColorOption ? handleizeColor(selectedColor ?? '') : '';
    const slides = Array.from(this.querySelectorAll('slideshow-slide[data-media-index][data-media-color]'));
    if (!slides.length) return;

    const hasColorMatches =
      colorKey !== '' && slides.some((slide) => mediaColor(slide) !== 'all' && mediaColor(slide) === colorKey);
    const shouldFilter = hasColorOption && hasColorMatches;
    const visibleIndexes = new Map();
    let visibleIndex = 0;

    for (const slide of slides) {
      const isVisible = !shouldFilter || mediaColor(slide) === 'all' || mediaColor(slide) === colorKey;
      slide.hidden = !isVisible;
      slide.setAttribute('aria-hidden', String(!isVisible || visibleIndex > 0));

      if (isVisible) {
        const mediaIndex = Number(slide.dataset.mediaIndex);
        if (Number.isInteger(mediaIndex)) visibleIndexes.set(mediaIndex, visibleIndex);
        visibleIndex += 1;
      }
    }

    for (const element of this.querySelectorAll('[data-media-index][data-media-color]')) {
      const mediaIndex = Number(element.dataset.mediaIndex);
      const visibleMediaIndex = visibleIndexes.get(mediaIndex);
      const isVisible = visibleMediaIndex !== undefined;
      element.hidden = !isVisible;

      if (element instanceof HTMLButtonElement) {
        const isSelectionControl =
          element.classList.contains('slideshow-control') ||
          element.classList.contains('dialog-thumbnails-list__thumbnail');
        if (isSelectionControl) {
          element.setAttribute('aria-selected', String(visibleMediaIndex === 0));
        }
        const clickAction = element.getAttribute('on:click') ?? '';

        if (clickAction.includes('/select/') && visibleMediaIndex !== undefined) {
          element.setAttribute('on:click', `/select/${visibleMediaIndex}`);
        }

        const labelTemplate = element.dataset.slideLabelTemplate;
        if (labelTemplate && visibleMediaIndex !== undefined) {
          element.setAttribute(
            'aria-label',
            labelTemplate
              .replace('__INDEX__', String(visibleMediaIndex + 1))
              .replace('__LENGTH__', String(visibleIndexes.size))
          );
        }
        if (element.hasAttribute('data-slide-number') && visibleMediaIndex !== undefined) {
          element.textContent = String(visibleMediaIndex + 1);
        }
      }
    }

    const gridMedia = this.querySelectorAll('.media-gallery__grid > li[data-media-index]');
    for (const element of gridMedia) {
      element.removeAttribute('data-color-first-visible');
      element.removeAttribute('data-color-only-visible');
    }
    const firstVisibleGridMedia = Array.from(gridMedia).find((element) =>
      visibleIndexes.has(Number(element.dataset.mediaIndex))
    );
    firstVisibleGridMedia?.setAttribute('data-color-first-visible', '');
    if (visibleIndexes.size === 1) {
      firstVisibleGridMedia?.setAttribute('data-color-only-visible', '');
    }

    for (const total of this.querySelectorAll('[data-media-gallery-total]')) {
      total.textContent = String(visibleIndexes.size);
    }
    for (const current of this.querySelectorAll('[data-media-gallery-current]')) {
      current.textContent = '1';
    }

    const zoomDialog = this.refs.zoomDialogComponent;
    const zoomThumbnails = zoomDialog instanceof HTMLElement ? zoomDialog.refs?.thumbnails : undefined;
    if (zoomThumbnails) {
      const visibleThumbnail = Array.from(zoomThumbnails.querySelectorAll('button')).find(
        (thumbnail) => !thumbnail.hidden
      );
      for (const thumbnail of zoomThumbnails.querySelectorAll('button')) {
        thumbnail.setAttribute('aria-selected', String(thumbnail === visibleThumbnail));
      }
    }

    const slideshow = this.slideshow;
    if (slideshow && typeof slideshow.select === 'function') {
      slideshow.select(0, undefined, { animate: false });
    }
  }

  /**
   * Handles the 'zoom-media:selected' event.
   * @param {ZoomMediaSelectedEvent} event - The zoom-media:selected event.
   */
  #handleZoomMediaSelected = async (event) => {
    const slideshow = this.slideshow;
    if (!slideshow || !Array.isArray(slideshow.refs?.slides)) return;

    const selectedSlide = slideshow.refs.slides.find(
      (slide) => Number(slide.dataset.mediaIndex) === event.detail.index
    );
    const visibleIndex = selectedSlide ? slideshow.slides?.indexOf(selectedSlide) : -1;
    if (visibleIndex !== undefined && visibleIndex >= 0) {
      await slideshow.select(visibleIndex, undefined, { animate: false });
    }
  };

  /**
   * Keeps every responsive counter in sync with the slideshow's visible slide index.
   * @param {SlideshowSelectEvent} event - The selected slide event.
   */
  #handleSlideshowSelected = (event) => {
    const total = this.slideshow?.slides?.length ?? 0;
    for (const current of this.querySelectorAll('[data-media-gallery-current]')) {
      current.textContent = String(event.detail.index + 1);
    }
    for (const count of this.querySelectorAll('[data-media-gallery-total]')) {
      count.textContent = String(total);
    }
  };

  /**
   * Zooms the media gallery.
   *
   * @param {number} index - The index of the media to zoom.
   * @param {PointerEvent} event - The pointer event.
   */
  zoom(index, event) {
    this.refs.zoomDialogComponent?.open(index, event);
  }

  /**
   * Preloads an image.
   * @param {number} index - The index of the media to preload.
   */
  preloadImage(index) {
    const zoomDialogMedia = this.refs.zoomDialogComponent?.refs.media[index];
    if (!zoomDialogMedia) return;

    this.refs.zoomDialogComponent?.loadHighResolutionImage(zoomDialogMedia);
  }

  get slideshow() {
    return this.refs.slideshow;
  }

  get media() {
    return this.refs.media;
  }

  get presentation() {
    return this.dataset.presentation;
  }
}

function handleizeColor(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function isColorOption(name) {
  const normalizedName = name.trim().toLowerCase();
  return normalizedName === 'color' || normalizedName === 'colour';
}

function mediaColor(element) {
  return element.dataset.mediaColor ?? 'all';
}

if (!customElements.get('media-gallery')) {
  customElements.define('media-gallery', MediaGallery);
}
