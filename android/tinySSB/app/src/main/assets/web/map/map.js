const mapOperation = {
    SELECT_MAP: 'map/selectMap',
    SHARE_MAP: 'map/shareMap',
    ADD_PIN: 'map/addPin'
}


//============================
// MAIN-MENU HANDLER FUNCTIONS
//============================

function sync_pins(){
    // closeOverlay()
    // document.getElementById('overlay-bg').style.display = 'initial';
    // //document.getElementById('TODO_add_content').innerHTML = ''
    // overlayIsActive = true;

    launch_snackbar("Would open sync pins UI here... TODO");

    // TODO : get inspired by "function menu_board_invitations()" and "function menu_board_invitation_create_entry(bid)" in board_ui.js .
    // Something like "function menu_history()" (board_ui.js) might be interesting here as well.
}

function share_map_menu(){
    //TODO implementation somewhat related to sync_pins() above. (But this time perhaps no subscribe needed)
    launch_snackbar("Would open share dialog here... TODO");
}

function receive_map_dialog(){
    //TODO this feature might or might not be needed, depending on what kind of implementation is chosen for share map...
    launch_snackbar("Would open receive dialog here... TODO");
}

/*
* Function to change the MBTile used by local backend SQLite asset provider (e.g. MbTilesPathHandler.kt).
* (TODO implementation)
*/
function load_map(someIdOfMap){
    //TODO ... selectMBTile( /*TODO*/ )
    launch_snackbar("Would open select overlay map dialog here... TODO");
}

//========================
// FURTHER-BACKEND HANDOFF
//========================

/*

function shareMapWithContact(contact, map) {
    //...
    sendToBackend();
}

function recieveMapFromContact(contact, map) {
    //...
    sendToBackend();
}*/



function selectMBTile() {
    launch_snackbar("Would open select dialog here... TODO")
    //...
    sendToBackend();
}


function sendToBackend( /*TODO*/ ){
    //TODO : implement interfacing functionality
}