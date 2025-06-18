var imgTotalNum = 2;
var lastRandNum = 0;

function getRandomInt(max, last){
	var imgNum = last;
	while (imgNum == last) {
		imgNum = Math.floor(Math.random() * Math.floor(max));
	}
  	return imgNum;
}

function onLoadImg(){
	var imgNum = getRandomInt(0);
	document.write('<img class="figure-img img-fluid rounded" src="static/xiuyu_' + imgNum.toString() +
		'.png" style="width: 250px; height: 270px" alt onClick="mouseOver(this)"/>');
}

function mouseOver(profileImage){
	// var imgNum = getRandomInt(imgTotalNum, lastRandNum);
	var imgNum = 0;
	profileImage.src = "static/xiuyu_" + imgNum.toString() + ".png";
	index_description = getDescription(imgNum);
	document.getElementById("index-img-description").innerHTML = index_description;
	lastRandNum = imgNum;
}

function getDescription(imgNum) {
	switch (imgNum) {
		case 0: return "";
		case 1: 
			text = "Arcane"
			return "Me in " + text.link("https://github.com/Sxela/ArcaneGAN");
		// case 1: return "Green Lake, Syracuse, NY, 2020";
		// case 2: return "Brooklyn Bridge, NY, 2021";
	}
}
