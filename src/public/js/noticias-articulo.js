/**
 * Acciones de lectura del artículo: copiar enlace e imprimir.
 *
 * Se carga para todo el mundo (no solo administradores), por eso vive separado
 * de noticias-detalle.js, que solo se sirve a quien puede editar.
 */
(function () {
  'use strict';

  var MENSAJE_MS = 2000;

  /**
   * Copia texto al portapapeles. `navigator.clipboard` exige contexto seguro,
   * así que en HTTP se recurre a un textarea temporal.
   * @param {string} texto
   * @returns {Promise<void>}
   */
  function copiar(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto);
    }

    return new Promise(function (resolver, rechazar) {
      var campo = document.createElement('textarea');
      campo.value = texto;
      campo.setAttribute('readonly', '');
      campo.style.position = 'fixed';
      campo.style.opacity = '0';
      document.body.appendChild(campo);
      campo.select();

      try {
        document.execCommand('copy') ? resolver() : rechazar(new Error('copy falló'));
      } catch (error) {
        rechazar(error);
      } finally {
        document.body.removeChild(campo);
      }
    });
  }

  function init() {
    var botonCopiar = document.querySelector('[data-copiar-enlace]');
    var botonImprimir = document.querySelector('[data-imprimir]');

    if (botonCopiar) {
      var etiqueta = botonCopiar.querySelector('[data-copiar-texto]') || botonCopiar;
      var original = etiqueta.textContent;
      var temporizador = null;

      // Mensajes cortos: el botón vive en una columna de 300 px.
      botonCopiar.addEventListener('click', function () {
        copiar(window.location.href)
          .then(function () { etiqueta.textContent = 'Copiado'; })
          .catch(function () { etiqueta.textContent = 'Error'; })
          .then(function () {
            botonCopiar.classList.add('is-hecho');
            window.clearTimeout(temporizador);
            temporizador = window.setTimeout(function () {
              etiqueta.textContent = original;
              botonCopiar.classList.remove('is-hecho');
            }, MENSAJE_MS);
          });
      });
    }

    if (botonImprimir) {
      botonImprimir.addEventListener('click', function () {
        window.print();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
