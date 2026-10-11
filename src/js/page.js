document.addEventListener('DOMContentLoaded', () => {


    // button listener
    const buttons = document.querySelectorAll('button[data-src]');
    const video = document.getElementById('game-video');
  
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const newSrc = button.getAttribute('data-src');
        const source = video.querySelector('source');
        source.src = newSrc;
        video.load();
        video.play();
      });
    });
    // button listener

  });