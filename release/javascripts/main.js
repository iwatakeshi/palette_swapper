//globals

var currentPalette;
var skipFirstColor = true;
var labmemo = {};
var nearestmemo = {};
var dithering = false;
var worker;

// Initialize worker (remove the blob hack)
if (window.Worker) {
  worker = new Worker("javascripts/worker.js");

  worker.onmessage = function (e) {
    let canvasB = document.getElementById("image_after");
    let ctx = canvasB.getContext("2d");
    let imageData = ctx.getImageData(0, 0, canvasB.width, canvasB.height);
    imageData.data.set(e.data[0]);
    ctx.putImageData(imageData, 0, 0);
    nearestmemo = e.data[1];
    console.log("message received from worker");
  };
}

function drawImageFromFile() {
  //this is the original image
  let canvas = document.getElementById("image_before");
  //the modified image appears here
  let canvasB = document.getElementById("image_after");
  //normal Canvas setup
  let ctx = canvas.getContext("2d");
  let img = new Image();
  //this is the file, chosen by the user in the file selector
  let curFile = document.getElementById("uploadImage").files[0];
  let url = window.URL || window.webkitURL;
  let src = url.createObjectURL(curFile);
  img.src = src;
  img.onload = function () {
    //scale the images so they don't go off the screen
    let width = this.width;
    let height = this.height;
    let ratio;
    if (this.height > window.screen.availHeight) {
      height = window.screen.availHeight - window.screen.availHeight * 0.2;
      ratio = height / this.height;
      width = ratio * this.width;
    } else if (this.width > window.screen.availWidth / 2) {
      width =
        Math.floor(window.screen.availWidth / 2) -
        window.screen.availWidth * 0.1;
      ratio = width / this.width;
      height = ratio * this.height;
    }
    canvas.width = width;
    canvas.height = height;
    canvasB.width = width;
    canvasB.height = height;
    //draw
    ctx.drawImage(img, 0, 0, width, height);
    url.revokeObjectURL(src);
    canvasB.getContext("2d").drawImage(canvas, 0, 0); //this copies the image to the right before processing happens.  it's not necessary, but I kind of like it.
  };
}

function drawPalette() {
  //this should be called by paletteSetup
  //this sets up the canvas that displays the color swatches
  let canvas = document.getElementById("palette_display");
  let ctx = canvas.getContext("2d");
  let width = window.screen.availWidth * 0.75;
  canvas.width = width;
  //if the palette is small enough, it can be displayed with nice big squares
  let swatchSize = Math.ceil(width / currentPalette.length);
  let rows = 1;
  //20px is about the smallest I want one of the color-swatch squares to be
  if (swatchSize < 20) {
    swatchSize = 20;
    rows = (swatchSize * currentPalette.length) / width;
  }
  canvas.height = Math.ceil(rows) * swatchSize;
  //the actual drawing step
  _.each(currentPalette, function (swatch, index) {
    ctx.fillStyle = swatch.toString();
    ctx.fillRect(
      (index * swatchSize) % width,
      Math.floor((index * swatchSize) / width) * swatchSize,
      swatchSize,
      swatchSize
    );
  });
}

function paletteSetup() {
  //this removes black, which is often included at the beginning of palettes for some reason
  if (skipFirstColor) {
    currentPalette = _.rest(currentPalette);
  }
  //pre-calculate the Lab color for each (rgb) color in the palette
  for (var i = 0; i < currentPalette.length; ++i) {
    let swatch = d3.color(currentPalette[i].toString());
    currentPalette[i].d3color = swatch;
    currentPalette[i].lab = d3.lab(swatch);
  }
  //empty the nearestmemo cache; it assumes the current palette
  nearestmemo = {};
  drawPalette();
}

function loadPaletteFromFile() {
  //this is pretty similar to drawImageFromFile, but with palettes
  let file = document.getElementById("uploadPalette").files[0];
  //only the file extension is checked; i.e., it might be a valid file but need renaming
  let supportedByAnypalette = [
    "pal",
    "gpl",
    "txt",
    "psppalette",
    "hpl",
    "cs",
    "wpe",
  ];
  if (file.name.endsWith("ase")) {
    alert("No ASE support yet, sorry.");
  } else if (supportedByAnypalette.includes(_.last(file.name.split(".")))) {
    AnyPalette.loadPalette(file, function (error, palette) {
      if (palette) {
        currentPalette = palette;
        paletteSetup();
      } else if (error) {
        alert(error);
      }
      //this would mean that AnyPalette didn't catch an error, but also didn't return a palette
      else {
        alert("Something has gone horribly wrong.");
      }
    });
  } else {
    alert("The palette format is unsupported.");
  }
}

function swapColors() {
  let canvasA = document.getElementById("image_before");
  let canvasB = document.getElementById("image_after");
  //we're always reading from the "before" image and writing to the "after" image
  let ctx = canvasA.getContext("2d");

  //ctx.drawImage(canvasA, 0, 0);  //not necessary, but a matter of taste.  displays the original image on both sides before processing is done
  let imageData = ctx.getImageData(0, 0, canvasA.width, canvasA.height);

  if (worker) {
    //this is running in its own thread and won't hang the page (yay!)
    worker.postMessage([
      imageData.data,
      currentPalette,
      canvasA.width,
      dithering,
    ]);
    console.log("message posted to worker");
  } else {
    // Fallback: use shared processing function directly
    let data = new Uint8ClampedArray(imageData.data);

    let t0 = performance.now();

    // Call shared processing function (no duplication!)
    let result = processImageData(
      data,
      currentPalette,
      canvasA.width,
      dithering,
      nearestmemo,
      labmemo
    );

    let t1 = performance.now();
    console.log(`Time to swap colors: ${t1 - t0} ms`);

    ctx = canvasB.getContext("2d");
    let imageDataB = ctx.getImageData(0, 0, canvasB.width, canvasB.height);
    imageDataB.data.set(result.data);
    ctx.putImageData(imageDataB, 0, 0);

    nearestmemo = result.nearestmemo;
  }
}

//not sure yet if these are the functions I want bound to these listeners.  but I guess that can wait.
window.onload = function () {
  document
    .getElementById("uploadImage")
    .addEventListener("change", drawImageFromFile, false);
  document
    .getElementById("uploadPalette")
    .addEventListener("change", loadPaletteFromFile, false);
  document
    .getElementsByTagName("button")[0]
    .addEventListener("click", swapColors, false);
};
