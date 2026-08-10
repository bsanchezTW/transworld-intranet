/**
 * Buscador y filtros del listado de noticias.
 *
 * Todo el filtrado es local: el listado ya viene completo del servidor, así que
 * escribir en el buscador no dispara peticiones. Un único punto (`aplicar`)
 * decide la visibilidad, de modo que buscador y chips nunca se pisan.
 */
(function () {
  'use strict';

  var RETARDO_BUSQUEDA = 120;

  function init() {
    var toolbar = document.querySelector('[data-noticias-filtros]');
    if (!toolbar) return;

    var input = toolbar.querySelector('input[type="search"]');
    var chips = Array.prototype.slice.call(toolbar.querySelectorAll('[data-filtro-tipo]'));
    var noticias = Array.prototype.slice.call(document.querySelectorAll('[data-noticia]'));
    var vacio = document.getElementById('noticias-sin-resultados');

    var estado = { texto: '', tipo: '' };
    var temporizador = null;

    function coincide(elemento) {
      var texto = elemento.getAttribute('data-search') || '';
      var tipos = (elemento.getAttribute('data-tipos') || '').split(' ');
      var porTexto = !estado.texto || texto.indexOf(estado.texto) !== -1;
      var porTipo = !estado.tipo || tipos.indexOf(estado.tipo) !== -1;
      return porTexto && porTipo;
    }

    function aplicar() {
      var visibles = 0;

      noticias.forEach(function (elemento) {
        var visible = coincide(elemento);
        elemento.hidden = !visible;
        if (visible) visibles += 1;
      });

      if (vacio) vacio.hidden = visibles > 0;
    }

    function seleccionarChip(chip) {
      estado.tipo = chip.getAttribute('data-filtro-tipo') || '';
      chips.forEach(function (otro) {
        var activo = otro === chip;
        otro.classList.toggle('is-activo', activo);
        otro.setAttribute('aria-pressed', activo ? 'true' : 'false');
      });
      aplicar();
    }

    if (input) {
      input.addEventListener('input', function () {
        window.clearTimeout(temporizador);
        temporizador = window.setTimeout(function () {
          estado.texto = input.value.trim().toLowerCase();
          aplicar();
        }, RETARDO_BUSQUEDA);
      });

      // Escape limpia la búsqueda sin obligar a borrar a mano.
      input.addEventListener('keydown', function (evento) {
        if (evento.key !== 'Escape' || !input.value) return;
        input.value = '';
        estado.texto = '';
        aplicar();
      });
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        seleccionarChip(chip);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
