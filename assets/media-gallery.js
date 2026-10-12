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

    const selectedColor = event.selectedOptions.find(
      (option) => normalizeColor(option.name) === 'color'
    )?.value;
    this.dataset.selectedColor = normalizeColor(selectedColor ?? '');
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
   * Applies the selected color to the existing media and control copies.
   * @param {string | undefined} selectedColor - The normalized Color option value.
   */
  #applyColorFilter(selectedColor) {
    const colorKey = normalizeColor(selectedColor ?? '');
    const slides = Array.from(this.querySelectorAll('slideshow-slide[data-media-index]'));
    if (!slides.length) return;

    const hasColorMatches = slides.some((slide) => mediaColors(slide).includes(colorKey));
    const shouldFilter = colorKey !== '' && hasColorMatches;
    const visibleIndexes = new Map();
    let visibleIndex = 0;

    for (const slide of slides) {
      const isVisible = !shouldFilter || mediaColors(slide).length === 0 || mediaColors(slide).includes(colorKey);
      slide.hidden = !isVisible;
      slide.setAttribute('aria-hidden', String(!isVisible || visibleIndex > 0));

      if (isVisible) {
        visibleIndexes.set(Number(slide.dataset.mediaIndex), visibleIndex);
        visibleIndex += 1;
      }
    }

    for (const element of this.querySelectorAll('[data-media-index][data-media-colors]')) {
      const mediaIndex = Number(element.dataset.mediaIndex);
      const isVisible = visibleIndexes.has(mediaIndex);
      element.hidden = !isVisible;

      if (element instanceof HTMLButtonElement) {
        element.setAttribute('aria-selected', String(visibleIndexes.get(mediaIndex) === 0));
        const clickAction = element.getAttribute('on:click') ?? '';
        const visibleItemIndex = visibleIndexes.get(mediaIndex);

        if (clickAction.includes('/select/') && visibleItemIndex !== undefined) {
          element.setAttribute('on:click', `/select/${visibleItemIndex}`);
        }

        const labelTemplate = element.dataset.slideLabelTemplate;
        if (labelTemplate && visibleItemIndex !== undefined) {
          element.setAttribute(
            'aria-label',
            labelTemplate
              .replace('__INDEX__', String(visibleItemIndex + 1))
              .replace('__LENGTH__', String(visibleIndexes.size))
          );
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

function normalizeColor(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function mediaColors(element) {
  return (element.dataset.mediaColors ?? '').split(',').filter(Boolean);
}

if (!customElements.get('media-gallery')) {
  customElements.define('media-gallery', MediaGallery);
}
