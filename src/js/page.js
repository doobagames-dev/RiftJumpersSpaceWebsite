// Gameplay video: the centered play button starts playback and hands over to
// the native controls.
const video = document.getElementById('game-video');
const play = document.getElementById('game-video-play');

if (video && play) {
	play.addEventListener('click', () => {
		video.controls = true;
		video.play();
	});
	video.addEventListener('play', () => {
		play.hidden = true;
		video.controls = true;
	});
}
