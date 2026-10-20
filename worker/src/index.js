
export default {
  async fetch(request) {
    return Response.json({
      status: "working",
      station: "Chislehurst",
      code: "CIT"
    });
  }
};
